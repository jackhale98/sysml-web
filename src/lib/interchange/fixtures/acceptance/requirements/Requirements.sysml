/* Requirements with subjects, constraints and redefined attributes; a
 * verification case; satisfy and verify relationships across files. */
package Reqs {
    private import SI::*;
    private import Basics::*;
    private import Vehicle::Structure::*;

    requirement def MassLimit {
        doc /* The vehicle shall not be heavier than the limit. */
        subject vehicle : Car;
        attribute limit : ISQ::MassValue;
        require constraint { vehicle.totalMass <= limit }
    }

    requirement def SpeedReq {
        subject vehicle : Car;
        attribute minimum : ISQ::SpeedValue;
        assume constraint { minimum > 0 [m / s] }
        require constraint { vehicle.maxSpeed >= minimum }
    }

    requirement carMass : MassLimit {
        subject vehicle : ElectricCar;
        attribute :>> limit = 1500 [kg];
    }

    requirement carSpeed : SpeedReq {
        subject vehicle : ElectricCar;
        attribute :>> minimum = 30 [m / s];
    }

    requirement vehicleSpec {
        subject vehicle : ElectricCar;
        require carMass;
        require carSpeed;
    }

    verification def MassTest {
        subject vehicle : ElectricCar;
        objective {
            verify carMass;
        }
        action weigh;
    }

    verification massTest : MassTest;
}

package Traceability {
    private import Reqs::*;

    satisfy carMass by Vehicle::Configurations::myCar;
    #Basics::Safety satisfy carSpeed by Vehicle::Configurations::myCar;
    metadata Basics::Safety about carMass {
        level = 2;
    }
    dependency trace from Reqs::carMass to Vehicle::Structure::Battery;
}
