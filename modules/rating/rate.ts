export type ChargeLine = {
  code: string;
  label: string;
  /** How the amount was derived, in words a person can check. */
  calculation: string;
  amount: number;
};

export type RateResult = { total: number; lines: ChargeLine[] };

export type CarrierRate = {
  baseRate: number;
  ratePerKm: number;
  ratePerKg: number;
  minimumCharge: number;
  fuelSurchargePct: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => round2(n).toFixed(2);

/**
 * Deterministic freight rating: every charge carries its own calculation so
 * a total can always be traced back to the contract rate and the shipment.
 */
export function rateWithCarrier(
  rate: CarrierRate,
  shipment: { distanceKm: number; weightKg: number },
): RateResult {
  const lines: ChargeLine[] = [];
  if (rate.baseRate > 0) {
    lines.push({
      code: "BASE",
      label: "Base rate",
      calculation: "Flat charge per shipment",
      amount: round2(rate.baseRate),
    });
  }
  if (rate.ratePerKm > 0) {
    lines.push({
      code: "DISTANCE",
      label: "Distance",
      calculation: `${fmt(shipment.distanceKm)} km × ${fmt(rate.ratePerKm)} per km`,
      amount: round2(shipment.distanceKm * rate.ratePerKm),
    });
  }
  if (rate.ratePerKg > 0) {
    lines.push({
      code: "WEIGHT",
      label: "Weight",
      calculation: `${fmt(shipment.weightKg)} kg × ${fmt(rate.ratePerKg)} per kg`,
      amount: round2(shipment.weightKg * rate.ratePerKg),
    });
  }

  let linehaul = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  if (rate.minimumCharge > linehaul) {
    lines.push({
      code: "MINIMUM",
      label: "Minimum charge adjustment",
      calculation: `Minimum ${fmt(rate.minimumCharge)} − linehaul ${fmt(linehaul)}`,
      amount: round2(rate.minimumCharge - linehaul),
    });
    linehaul = round2(rate.minimumCharge);
  }
  if (rate.fuelSurchargePct > 0) {
    lines.push({
      code: "FUEL",
      label: "Fuel surcharge",
      calculation: `${fmt(rate.fuelSurchargePct)}% of linehaul ${fmt(linehaul)}`,
      amount: round2((linehaul * rate.fuelSurchargePct) / 100),
    });
  }
  return { total: round2(lines.reduce((sum, l) => sum + l.amount, 0)), lines };
}

/** Cost of running a shipment on the organization's own vehicle. */
export function rateOwnVehicle(
  vehicle: { costPerKm: number; fixedCost: number },
  shipment: { distanceKm: number },
): RateResult {
  const lines: ChargeLine[] = [];
  if (vehicle.fixedCost > 0) {
    lines.push({
      code: "FIXED",
      label: "Vehicle fixed cost",
      calculation: "Flat cost per trip",
      amount: round2(vehicle.fixedCost),
    });
  }
  if (vehicle.costPerKm > 0) {
    lines.push({
      code: "DISTANCE",
      label: "Running cost",
      calculation: `${fmt(shipment.distanceKm)} km × ${fmt(vehicle.costPerKm)} per km`,
      amount: round2(shipment.distanceKm * vehicle.costPerKm),
    });
  }
  return { total: round2(lines.reduce((sum, l) => sum + l.amount, 0)), lines };
}
