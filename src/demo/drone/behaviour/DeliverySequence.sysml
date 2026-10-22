package DeliverySequence {
    doc
    /*
     * Who tells whom what, and in which order, during one parcel delivery: an interaction
     * between the people and systems of DeliveryContext. Each `message` names what it
     * carries (`of FlightPlan`), who sends it (`from`) and who receives it (`to`); `then`
     * says it comes after the message before it. Read it top to bottom, like the
     * Sequence View draws it.
     */

    private import DroneInterfaces::*;
    private import DeliveryContext::*;
    private import DroneArchitecture::DeliveryDrone;

    occurrence def ParcelDelivery {
        doc /* One delivery, from planning the flight to handing over the parcel. */

        // The lifelines: the parts taking part, referred to (`ref`), not owned.
        ref part operator : Operator;
        ref part groundStation : GroundStation;
        ref part drone : DeliveryDrone;
        ref part recipient : Recipient;

        message planDelivery of FlightPlan from operator to groundStation {
            doc /* The operator plans the route to the recipient's drop point. */
        }
        then message uploadPlan of FlightPlan from groundStation to drone {
            doc /* The ground station sends the plan over the radio link. */
        }
        then message preflightReport of Telemetry from drone to groundStation {
            doc /* Battery charge and position: is the drone ready to go? */
        }
        then message launch of TakeOffCommand from operator to groundStation {
            doc /* The operator checks the report and clears the drone for take-off. */
        }
        then message takeOff of TakeOffCommand from groundStation to drone;
        then message flightStatus of Telemetry from drone to groundStation {
            doc /* Several times a second, all the way to the drop point and back. */
        }
        then message handOver of Parcel from drone to recipient {
            doc /* The latch opens over a clear drop zone and the parcel is let down. */
        }
        then message deliveryReport of Telemetry from drone to groundStation {
            doc /* The parcel is delivered and the drone is on its way home. */
        }
    }
}
