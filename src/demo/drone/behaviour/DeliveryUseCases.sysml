package DeliveryUseCases {
    doc
    /*
     * What the delivery service does for the people around it, beside the delivery itself
     * (DeliveryMission::DeliverParcel). Each use case names its subject, the drone, and its
     * actors: the people who take part. An `include` makes one use case part of another.
     */

    private import DroneArchitecture::DeliveryDrone;
    private import DeliveryContext::*;

    use case def PlanRoute {
        doc /* The operator plans the route to the drop point and has it approved. */
        subject drone : DeliveryDrone;
        actor operator : Operator;
        actor authority : AviationAuthority;
        objective {
            doc /* An approved route, uploaded to the drone before take-off. */
        }
    }

    use case def ChargeBattery {
        doc /* Between flights the operator charges the battery at the depot. */
        subject drone : DeliveryDrone;
        actor operator : Operator;
        objective {
            doc /* A full battery before the next flight. */
        }
    }

    use case def VerifyDropZone {
        doc /* Before it lets the parcel down, the drone checks that nobody is in the drop zone. */
        subject drone : DeliveryDrone;
        actor recipient : Recipient;
        objective {
            doc /* The parcel is released only over a clear drop zone. */
        }
    }
}
