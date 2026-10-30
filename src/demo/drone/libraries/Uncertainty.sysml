library package Uncertainty {
    doc
    /*
     * Values that are not known exactly: a mass that varies from part to
     * part, a power measured to within a few watts. Give the value as usual
     * (that is its nominal, which every tool reads as before), and add an
     * attribute typed by one of the distributions below inside it:
     *
     *   attribute :>> mass = 1100 [g] {
     *       attribute tolerance : Tolerance { :>> plus = 60 [g]; :>> minus = 40 [g]; }
     *   }
     *   attribute :>> powerDraw = 92 [W] {
     *       attribute uncertainty : Normal { :>> standardDeviation = 4 [W]; }
     *   }
     *
     * Write the numbers with units, in any unit of the same kind as the
     * value (a tolerance in g on a mass in kg); a number without a unit is
     * in the value's unit. Budgets and checks then show the likely range of
     * each result and how often a limit is met, worked out by sampling.
     *
     * Why attributes and not metadata: SysML v2 allows only model-level
     * evaluable expressions in metadata, and a quantity with a unit
     * (`60 [g]`) is not one, so a tolerance in metadata could not carry its
     * unit. These are ordinary attribute definitions and usages: any SysML v2
     * tool reads them as attributes of the value, with their units.
     */

    private import ScalarValues::Real;

    abstract attribute def Distribution {
        doc /* How an uncertain value varies. The value it is inside of is the nominal. */
    }

    attribute def Normal :> Distribution {
        doc /* A bell curve: most values near the mean, fewer further out. Right for a value
             * whose errors add up from many small causes (a measurement, a mass of many parts). */
        attribute mean [0..1] { doc /* Leave out to take the nominal value. */ }
        attribute standardDeviation { doc /* About 68 % of values lie within one of the mean, 99.7 % within three. */ }
    }

    attribute def Uniform :> Distribution {
        doc /* Any value from min to max as likely as any other: all you know is the range. */
        attribute min;
        attribute max;
    }

    attribute def Triangular :> Distribution {
        doc /* Most likely at the mode, less likely towards min and max: a range with a best guess. */
        attribute min;
        attribute mode [0..1] { doc /* Leave out to take the nominal value. */ }
        attribute max;
    }

    enum def ToleranceReading {
        doc /* How a tolerance band is read as a distribution. */
        enum normal {
            doc /* A normal distribution centred on the band, which spans `sigmas` standard
                 * deviations each way (3: 99.73 % of values inside the band). */
        }
        enum uniform { doc /* Any value in the band as likely as any other. */ }
        enum triangular { doc /* Most likely at the nominal, falling to none at the band's ends. */ }
    }

    attribute def Tolerance :> Distribution {
        doc /* A tolerance band: the nominal +plus/-minus. Worst-case analysis takes the band's
             * ends; sampling reads the band as `reading` says. */
        attribute plus { doc /* How far above the nominal the band goes. */ }
        attribute minus [0..1] { doc /* How far below the nominal it goes. Leave out for a symmetric band (+/- plus). */ }
        attribute reading : ToleranceReading default ToleranceReading::normal;
        attribute sigmas : Real default 3.0 { doc /* For the normal reading: standard deviations each way the band spans. */ }
    }
}
