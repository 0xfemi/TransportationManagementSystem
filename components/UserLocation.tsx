"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Circle, Marker, Popup, useMap } from "react-leaflet";
import { LocateFixed, X } from "lucide-react";

/**
 * Shows the signed-in user's own position on the map.
 *
 * The browser's permission prompt is preceded by our own one-line ask, so a
 * user knows why it appears and can say "not now" without the browser
 * remembering a hard block. The position stays in this browser tab: it is
 * never sent to the server.
 */

type State =
  | "checking"
  | "ask" // permission not yet decided: show our prompt
  | "later" // user chose "Not now"; offer the locate button only
  | "waiting" // browser prompt open or first fix pending
  | "watching"
  | "denied" // blocked in the browser
  | "unavailable"; // no geolocation, or not a secure (https) page

type Fix = { latitude: number; longitude: number; accuracy: number };

// "Not now" is remembered per browser so every map does not ask again.
const DECLINED_KEY = "tms_location_declined";

const readDeclined = () => {
  try {
    return localStorage.getItem(DECLINED_KEY) === "1";
  } catch {
    return false;
  }
};
const writeDeclined = (value: boolean) => {
  try {
    if (value) localStorage.setItem(DECLINED_KEY, "1");
    else localStorage.removeItem(DECLINED_KEY);
  } catch {
    // Storage blocked: the prompt simply shows again next time.
  }
};

const youIcon = L.divIcon({
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: '<div style="width:18px;height:18px;border-radius:999px;background:#2563eb;box-shadow:0 0 0 3px #fff,0 0 0 6px rgba(37,99,235,.25)"></div>',
});

/** Stops clicks and scrolls on an overlay from panning or zooming the map. */
function useIsolated<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!ref.current) return;
    L.DomEvent.disableClickPropagation(ref.current);
    L.DomEvent.disableScrollPropagation(ref.current);
  });
  return ref;
}

export function UserLocation() {
  const map = useMap();
  const [state, setState] = useState<State>("checking");
  const [fix, setFix] = useState<Fix | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const watchId = useRef<number | null>(null);
  // Pan to the first fix only when the user asked for it, so turning tracking
  // on in the background never yanks the map away from what they are viewing.
  const centreOnNextFix = useRef(false);
  const promptRef = useIsolated<HTMLDivElement>();
  const buttonRef = useIsolated<HTMLDivElement>();

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  }, []);

  const start = useCallback(
    (centre: boolean) => {
      if (watchId.current !== null) return;
      centreOnNextFix.current = centre;
      setState("waiting");
      watchId.current = navigator.geolocation.watchPosition(
        (position) => {
          const next = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };
          setFix(next);
          setState("watching");
          writeDeclined(false);
          if (centreOnNextFix.current) {
            centreOnNextFix.current = false;
            map.flyTo([next.latitude, next.longitude], Math.max(map.getZoom(), 13));
          }
        },
        (error) => {
          stop();
          setFix(null);
          setState(error.code === error.PERMISSION_DENIED ? "denied" : "later");
        },
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
      );
    },
    [map, stop],
  );

  useEffect(() => {
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setState("unavailable");
      return;
    }
    let status: PermissionStatus | null = null;
    const apply = (permission: PermissionState) => {
      if (permission === "granted") start(false);
      else if (permission === "denied") {
        stop();
        setFix(null);
        setState("denied");
      } else setState(readDeclined() ? "later" : "ask");
    };
    // Some browsers (older Safari) cannot report the permission state; asking
    // first is then the safe default.
    const unknown = () => setState(readDeclined() ? "later" : "ask");
    if (!navigator.permissions?.query) {
      unknown();
    } else {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          status = result;
          apply(result.state);
          result.onchange = () => apply(result.state);
        })
        .catch(unknown);
    }
    return () => {
      if (status) status.onchange = null;
      stop();
    };
  }, [start, stop]);

  const locate = () => {
    if (state === "denied") {
      setShowBlocked((v) => !v);
    } else if (state === "watching" && fix) {
      map.flyTo([fix.latitude, fix.longitude], Math.max(map.getZoom(), 13));
    } else {
      start(true);
    }
  };

  if (state === "checking" || state === "unavailable") return null;

  const buttonLabel =
    state === "denied"
      ? "Location is blocked for this site. Allow it in your browser's site settings, then reload."
      : state === "watching"
        ? "Centre the map on your location"
        : state === "waiting"
          ? "Finding your location…"
          : "Show your location";

  return (
    <>
      {fix && (
        <>
          {/* Shaded circle: the browser's own estimate of how accurate the fix is. */}
          <Circle
            center={[fix.latitude, fix.longitude]}
            radius={fix.accuracy}
            pathOptions={{ color: "#2563eb", weight: 1, opacity: 0.4, fillOpacity: 0.08 }}
          />
          <Marker position={[fix.latitude, fix.longitude]} icon={youIcon} zIndexOffset={2000} title="You are here">
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">You are here</p>
                <p className="mt-0.5 text-zinc-600">Accurate to about {Math.round(fix.accuracy)} m. Only you can see this.</p>
              </div>
            </Popup>
          </Marker>
        </>
      )}

      {state === "ask" && (
        <div
          ref={promptRef}
          role="dialog"
          aria-label="Share your location with this map"
          className="absolute left-3 right-3 top-3 z-[1000] mx-auto flex max-w-md items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-md"
        >
          <LocateFixed className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
          <div className="flex-1">
            <p className="font-medium text-zinc-900">Show your location on the map?</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Your browser will ask for permission. Your position is shown only to you and is not saved or shared.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => start(true)}
                className="h-7 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-white hover:bg-zinc-700"
              >
                Allow location
              </button>
              <button
                type="button"
                onClick={() => {
                  writeDeclined(true);
                  setState("later");
                }}
                className="h-7 rounded-md px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
              >
                Not now
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              writeDeclined(true);
              setState("later");
            }}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div ref={buttonRef} className="absolute bottom-6 right-3 z-[1000] flex items-end gap-2">
        {state === "denied" && showBlocked && (
          <p role="status" className="max-w-[16rem] rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-600 shadow-sm">
            {buttonLabel}
          </p>
        )}
        <button
          type="button"
          onClick={locate}
          disabled={state === "waiting"}
          title={buttonLabel}
          aria-label={buttonLabel}
          className={
            "flex h-9 w-9 items-center justify-center rounded-md border bg-white shadow-sm transition-colors disabled:cursor-not-allowed " +
            (state === "watching"
              ? "border-blue-300 text-blue-600 hover:bg-blue-50"
              : state === "denied"
                ? "border-zinc-200 text-zinc-400 hover:bg-zinc-50"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50")
          }
        >
          <LocateFixed className={"h-4 w-4" + (state === "waiting" ? " animate-pulse" : "")} aria-hidden />
        </button>
      </div>
    </>
  );
}
