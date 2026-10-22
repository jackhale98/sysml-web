package BatteryTrade {
    doc
    /*
     * Which battery should the drone carry? A trade study compares design alternatives
     * against criteria and selects one by an objective.
     *   The alternatives: the battery the design flies today (drone.battery) and three
     *   candidate packs, the variants of `batteryOptions`.
     *   The evaluation function works out what each pack would give the drone: its
     *   take-off mass, the power to hover at that mass, the endurance, the margin to the
     *   4 kg limit and the price, and weighs them into one score.
     *   The objective (MaximizeObjective) selects the pack with the highest score.
     */

    private import ScalarValues::Real;
    private import ISQ::*;
    private import SI::*;
    private import TradeStudies::*;
    private import DroneComponents::Battery;
    private import DroneArchitecture::drone;
    private import DronePerformance::HoverEndurance;

    // The candidates. A variation lists the choices a design can make; each variant is
    // one of them, here a Battery with its own datasheet values.
    variation part batteryOptions : Battery {
        variant part lithiumPolymer : Battery {
            doc /* Six-cell lithium-polymer pack: cheap, but heavier for its energy, and only
                 * 80 % of it is usable without wearing the cells out. */
            attribute :>> mass = 1250 [g];
            attribute :>> nominalVoltage = 22.2 [V];
            attribute :>> capacity = 222 [W*h];
            attribute :>> usableFraction = 0.8;
            attribute :>> price = 260.0;
        }
        variant part lithiumIon3P : Battery {
            doc /* The same lithium-ion cells as today's pack, three in parallel instead of two:
                 * half as much energy again, and 380 g more. */
            attribute :>> mass = 1480 [g];
            attribute :>> capacity = 324 [W*h];
            attribute :>> price = 560.0;
        }
        variant part semiSolidState : Battery {
            doc /* Semi-solid-state lithium cells: 260 W*h in 1 kg, and 90 % usable, at more than
                 * twice the price. */
            attribute :>> mass = 1000 [g];
            attribute :>> capacity = 260 [W*h];
            attribute :>> usableFraction = 0.9;
            attribute :>> price = 1150.0;
        }
    }

    calc def HoverPower {
        doc /* The power to hover grows with the mass to the power 1.5 (momentum theory), so
             * the drone's measured hover power can be scaled to another take-off mass. */
        in takeOffMass :> mass;
        in referenceMass :> mass;
        in referencePower :> power;
        return :> power = referencePower * (takeOffMass / referenceMass) ** 1.5;
    }

    calc def BatteryScore {
        doc /* Each criterion is scored from 0 (poor) to 1 (excellent) and weighted: endurance
             * 50 %, mass margin 20 %, price 30 %. A pack that puts the drone over its 4 kg
             * take-off mass limit scores 0. */
        in endurance :> duration;
        in massMargin :> mass;
        in price : Real;
        attribute enduranceScore : Real = (endurance - 25 [min]) / 15 [min];  // 25 min: 0, 40 min: 1
        attribute massScore : Real = massMargin / 0.5 [kg];                   // no margin: 0, 0.5 kg: 1
        attribute priceScore : Real = (1500 - price) / 1500;                  // 1500 euros: 0
        return score : Real = if massMargin < 0 [kg] ? 0.0
            else 0.5 * enduranceScore + 0.2 * massScore + 0.3 * priceScore;
    }

    analysis batteryTradeStudy : TradeStudy {
        doc /* Today's battery against three candidate packs. Expected result: the
             * semi-solid-state pack scores best (0.59), well ahead of today's pack (0.39),
             * despite costing almost three times as much. */
        subject : Battery[4] = (drone.battery, batteryOptions::lithiumPolymer,
            batteryOptions::lithiumIon3P, batteryOptions::semiSolidState);
        objective : MaximizeObjective;

        calc :>> evaluationFunction {
            in part pack :>> alternative : Battery;
            attribute takeOffMass :> mass = drone.takeOffMass - drone.battery.mass + pack.mass;
            attribute hoverPower :> power = HoverPower(takeOffMass, drone.takeOffMass, drone.hoverPower);
            attribute endurance :> duration = HoverEndurance(pack.usableEnergy, hoverPower);
            attribute massMargin :> mass = 4 [kg] - takeOffMass;
            attribute price : Real = pack.price;
            return :>> result : Real = BatteryScore(endurance, massMargin, price);
        }

        return part :>> selectedAlternative : Battery;
    }
}
