package DroneViews {
    doc
    /*
     * The saved diagrams and tables of the model. A view is part of the model too:
     * `expose` picks the elements to start from (::* for their members, ::** for everything
     * nested inside), `filter` keeps only certain kinds of element, and the view's
     * definition (GeneralView, InterconnectionView, ...) says what kind of diagram it is.
     * Only the positions of boxes on the canvas are stored outside the model.
     */

    private import StandardViewDefinitions::*;
    private import Views::asTreeDiagram;
    private import Reporting::*;
    private import RiskAnalysis::DesignFmeaWorksheet;
    private import RiskAnalysis::FmeaRiskReduction;
    private import RiskAnalysis::RiskMatrix;
    private import HazardAnalysis::HazardLog;
    private import ModelViews::*;

    // Tables. Each is a view typed by a standard table from ModelViews
    // (libraries/ModelViews.sysml): change `expose` to pick what it lists,
    // or edit the view def there to change its columns.

    view systemRequirements : RequirementsTable {
        doc /* The system requirements with their classification, status and trace links. */
        expose SystemRequirements::*;
    }

    view droneInterfaces : InterfaceTable {
        doc /* Every port of the drone's components and what it is connected to. */
        expose DroneComponents::**;
    }

    view droneBillOfMaterials : BillOfMaterials {
        doc /* What the drone is made of, with quantities. */
        expose DroneArchitecture::drone::**;
    }

    view droneMassBudget : MassBudget {
        doc /* What each part of the drone weighs, and how the masses add up. */
        expose DroneArchitecture::drone::**;
    }

    view dronePowerBudget : PowerBudget {
        doc /* The electrical power each part of the drone draws in hover, and the total. */
        expose DroneArchitecture::drone::**;
    }

    view designChecks : ConstraintChecks {
        doc /* Does the design meet its requirements? Each requirement's constraint, checked against the design's values. */
    }

    view batteryTrade : TradeStudyTable {
        doc /* Which battery to fly: today's pack against three candidates, on endurance, mass margin and price. */
        expose BatteryTrade::batteryTradeStudy;
    }

    // Diagrams.

    view serviceContext : InterconnectionView {
        doc /* The drone in its world: operator, ground station and recipient. */
        expose DeliveryContext::deliveryService::*;
    }

    view componentCatalogue : GeneralView {
        doc /* The component definitions and how each specializes Component. */
        expose DroneComponents::*;
        filter @SysML::PartDefinition;
    }

    view droneBreakdown : GeneralView {
        doc /* The parts tree of our drone design: what it is made of, and how many. */
        expose DroneArchitecture::drone::**;
        filter @SysML::PartUsage;
        render asTreeDiagram;
    }

    view droneInterconnection : InterconnectionView {
        doc /* The drone's parts with their ports, and the power, command and signal connections between them. */
        expose DroneArchitecture::drone::*;
    }

    view requirementTree : GeneralView {
        doc /* Stakeholder needs and the system requirements derived from them. */
        expose StakeholderNeeds::*;
        expose SystemRequirements::*;
        filter @SysML::RequirementUsage or @SysML::ConnectionUsage;
    }

    view deliveryFlightFlow : ActionFlowView {
        doc /* The steps of one delivery flight, with the fork, join, decision and merge. */
        expose DeliveryMission::DeliveryFlight;
    }

    view deliverySequence : SequenceView {
        doc /* Who tells whom what during one delivery, in time order from top to bottom. */
        expose DeliverySequence::ParcelDelivery;
    }

    view flightModeStates : StateTransitionView {
        doc /* The flight modes and what makes the drone switch between them. */
        expose FlightControl::FlightModes;
    }

    view requirementCoverage : RequirementsTraceMatrix {
        doc /* Which requirements are satisfied by the design and verified, and which are not yet. */
    }

    view traceMatrix : TraceMatrix {
        doc /* Every requirement down the side, the parts of the design that satisfy it across the top. */
    }

    view verificationMatrix : VerificationMatrix {
        doc /* Every requirement down the side, the tests that check it across the top. */
    }

    view fmeaWorksheet : DesignFmeaWorksheet {
        doc /* The design FMEA as a table, highest risk priority first. */
        expose DroneFmea::*;
    }

    view fmeaReview : DesignFmeaWorksheet {
        doc /* The lines the risk policy does not accept as they are: a review of the worksheet, saved as a view. */
        expose DroneFmea::*;
        @TableRendering { where = "Acceptability(severity, likelihood) != RiskAcceptability::acceptable"; }
    }

    view riskReduction : FmeaRiskReduction {
        doc /* The lines assessed before their controls too: the risk then and now, and what lowered it. */
        expose DroneFmea::*;
    }

    view riskMatrix : RiskMatrix {
        doc /* The design FMEA's lines by severity and likelihood, each cell coloured by the risk policy. */
        expose DroneFmea::*;
    }

    view hazardLog : HazardLog {
        doc /* Each hazard with the harms it can cause and the controls on it. */
        expose DroneFmea::*;
    }

    // Reports: documents to send for review, built from the views above.
    // What each contains is defined in libraries/ModelViews.sysml.

    view droneSpecification : SpecificationDocument {
        doc /* The stakeholder needs and system requirements, with their trace to the design and the tests. */
        @DocumentInfo { title = "Delivery drone requirements specification"; number = "DRN-SPEC-001"; status = "Draft for review"; }
        expose StakeholderNeeds::*;
        expose SystemRequirements::*;
    }

    view droneInterfaceControl : InterfaceControlDocument {
        doc /* How the drone's parts connect: the power, command and signal interfaces between them. */
        @DocumentInfo { title = "Delivery drone interface control document"; number = "DRN-ICD-001"; status = "Draft for review"; }
        expose DroneArchitecture::drone::*;
        expose DroneInterfaces::*;
    }
}
