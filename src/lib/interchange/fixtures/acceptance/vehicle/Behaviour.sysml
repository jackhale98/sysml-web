/* States with entry/do actions, guarded transitions on accepted signals,
 * actions with parameters and successions, and an allocation. */
package VehicleBehaviour {
    private import Basics::*;
    private import Vehicle::Structure::*;
    private import SI::*;

    attribute def StartSignal;
    attribute def StopSignal;

    action def Warm;
    action def Monitor;

    action def Drive {
        in item route : Command;
        out attribute distance : ISQ::LengthValue;
        action plan;
        action move;
        action report;
        first start then plan;
        first plan then move;
        first move then report;
        first report then done;
    }

    state def DriveStates {
        in attribute speed : ISQ::SpeedValue;
        entry; then off;
        state off;
        state on {
            entry action warm : Warm;
            do action monitor : Monitor;
        }
        transition switchOn first off accept StartSignal then on;
        transition switchOff first on accept StopSignal if speed <= 0 [m / s] then off;
    }

    allocation def DriveAllocation {
        end logical;
        end physical;
    }

    action drive : Drive;
    allocation driveOnCar : DriveAllocation allocate drive to Vehicle::Configurations::myCar;
}
