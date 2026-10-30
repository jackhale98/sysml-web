package GroundLink {
    doc
    /*
     * Two state machines that talk through ports: the console at the ground station
     * commands the drone's flight controller over a command link. Run `linkTest` in
     * Simulations to see both machines at once, on one clock, with each command the
     * console sends and where it arrives.
     */

    private import DroneInterfaces::*;
    private import DroneComponents::FlightController;
    private import DeliveryContext::GroundStation;

    item def StartFlight { doc /* The operator asks the console to launch the drone. */ }
    item def RecallDrone { doc /* The operator asks the console to bring the drone home. */ }

    part def Console :> GroundStation {
        doc /* A ground station whose console sends the launch commands by itself. */

        exhibit state console {
            doc /* Arms the drone, waits for the motors to spin up, then sends it off. */
            entry; then standby;

            state standby { doc /* Waiting for the operator. */ }
            state arming {
                doc /* The arm command has gone out; the motors spin up. */
                entry send new ArmCommand() via commandLink;
            }
            state launching {
                entry send new TakeOffCommand() via commandLink;
            }
            state watching { doc /* The drone is flying its mission. */ }

            transition launch first standby accept StartFlight then arming;
            transition spunUp first arming accept after 10 [SI::s] then launching;
            transition sent first launching then watching;
            transition recall first watching accept RecallDrone
                do send new ReturnHomeCommand() via commandLink then standby;
        }
    }

    part linkTest {
        doc /* The console and a flight controller, joined by a command link. */
        part station : Console;
        part controller : FlightController;
        interface link : CommandLink connect station.commandLink to controller.commandLink;
    }
}
