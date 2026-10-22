/**
 * The units a person can pick for a value, by what it measures: the SI
 * library's units (and the common others it defines: `min`, `h`, `W*h`)
 * of the value's dimension, the unit it is given in first.
 */
import { convert, parseUnit } from '#lib/engine/quantity.ts';

/** Units the SI library defines (`SI::kW` resolves; `SI::mW` doesn't). */
const CANDIDATES = [
	'kg',
	'g',
	'm',
	'mm',
	'cm',
	'km',
	's',
	'min',
	'h',
	'd',
	'W',
	'kW',
	'J',
	'kJ',
	'W*h',
	'kW*h',
	'V',
	'A',
	'N',
	'Pa',
	'Hz',
	'K',
	'L',
	'm/s',
	'km/h',
	'm^3',
	'm^2',
	'rad'
];

/** A unit for each ISQ value type the forms meet (its dimension decides the choices). */
const BY_TYPE: Record<string, string> = {
	MassValue: 'kg',
	LengthValue: 'm',
	DistanceValue: 'm',
	DiameterValue: 'm',
	DurationValue: 's',
	TimeValue: 's',
	PowerValue: 'W',
	EnergyValue: 'J',
	ElectricPotentialDifferenceValue: 'V',
	ElectricCurrentValue: 'A',
	ForceValue: 'N',
	PressureValue: 'Pa',
	FrequencyValue: 'Hz',
	ThermodynamicTemperatureValue: 'K',
	VolumeValue: 'm^3',
	AreaValue: 'm^2',
	SpeedValue: 'm/s',
	TorqueValue: 'N*m',
	MomentOfForceValue: 'N*m',
	AngularMeasureValue: 'rad'
};

/**
 * The units to offer: those of the same dimension as the value's (its
 * current unit, else its type's), the current one first. Empty for a plain
 * number (`Real`) or a quantity the app doesn't know.
 */
export function unitChoices(valueType: string | null, current: string | null): string[] {
	const reference = current ?? (valueType ? BY_TYPE[valueType] : undefined) ?? null;
	if (!reference || !parseUnit(reference)) return current ? [current] : [];
	const same = CANDIDATES.filter((u) => u !== reference && convert(1, u, reference) !== null);
	return [reference, ...same];
}

/** Whether a value type is a quantity (has units) rather than a plain number. */
export function isQuantity(valueType: string | null, unit: string | null): boolean {
	return !!unit || (!!valueType && /Value$/.test(valueType) && valueType !== 'NumericalValue');
}
