import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { coveringArea, uncovered } from "@/modules/serviceAreas/coverage";

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const OTTAWA = { latitude: 45.4215, longitude: -75.6972 };
const area = (id: string, at: { latitude: number; longitude: number }, radiusKm: number) => ({
  id,
  name: id,
  ...at,
  radiusKm,
});

describe("service area coverage", () => {
  it("finds the area containing a point", () => {
    expect(coveringArea(TORONTO, [area("gta", TORONTO, 50)])?.id).toBe("gta");
    // Toronto–Ottawa is ~352 km.
    expect(coveringArea(OTTAWA, [area("gta", TORONTO, 300)])).toBeNull();
    expect(coveringArea(OTTAWA, [area("gta", TORONTO, 360)])?.id).toBe("gta");
  });

  it("prefers the nearest centre where areas overlap", () => {
    const areas = [area("wide", TORONTO, 500), area("ottawa", OTTAWA, 20)];
    expect(coveringArea(OTTAWA, areas)?.id).toBe("ottawa");
  });

  it("restricts nothing when there are no areas", () => {
    const points = [{ name: "Ottawa store", ...OTTAWA }];
    expect(uncovered(points, [])).toEqual([]);
    expect(uncovered(points, [area("gta", TORONTO, 50)])).toEqual(points);
  });
});

describe("csv", () => {
  it("quotes separators and escapes quotes", () => {
    expect(toCsv(["a", "b"], [["x, y", 'say "hi"'], [1.5, null]])).toBe('a,b\r\n"x, y","say ""hi"""\r\n1.5,\r\n');
  });

  it("neutralises cells a spreadsheet would run as formulas, but not negative numbers", () => {
    expect(toCsv(["name"], [["=HYPERLINK(\"x\")"], ["@SUM(A1)"], ["+1"], [-12.5]])).toBe(
      'name\r\n"\'=HYPERLINK(""x"")"\r\n\'@SUM(A1)\r\n\'+1\r\n-12.5\r\n',
    );
  });
});
