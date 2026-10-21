package DroneViews {
    doc /* Saved diagrams and reports of the drone model. */

    private import DroneStructure::*;
    private import Reporting::*;
    private import StandardViewDefinitions::*;
    private import SystemRequirements::*;
    private import Views::*;

    view 'Drone structure' : GeneralView {
        doc /* The drone and all of its parts as a tree. */
        expose DroneStructure::droneSystem::**;
        filter @SysML::PartUsage;
        render asTreeDiagram;
    }

    view 'Drone interconnection' : InterconnectionView {
        doc /* The drone's top-level parts and the power and data connections between them. */
        expose DroneStructure::droneSystem::*;
        render asInterconnectionDiagram;
    }

    view 'System requirements' : GeneralView {
        doc /* All system requirements. */
        expose SystemRequirements::*;
        filter @SysML::RequirementUsage;
        render asTreeDiagram;
    }

    view 'Requirements coverage' : RequirementsTraceMatrix {
        doc /* Which requirements are satisfied and verified. */
    }
}
