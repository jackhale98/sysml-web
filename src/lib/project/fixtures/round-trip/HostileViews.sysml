package HostileViews {
	private import StandardViewDefinitions::*;
	private import Hostile::*;

	/* KEEP-30 a comment in a view package */
	view vehicleParts : GeneralView {
		doc /* KEEP-31 the vehicle's parts */
		expose Hostile::Vehicle::*;   // KEEP-32 an expose with a comment
		filter @SysML::PartUsage;
	}
}
