/* Nested packages, specialization, redefinition, multiplicities, units,
 * ports (including a conjugated one), an interface, metadata and an alias. */
package Vehicle {
    private import Basics::*;
    private import SI::*;

    package Structure {
        public import Basics::Component;

        part def Wheel :> Component {
            attribute :>> mass = 9.5 [kg];
            attribute diameter : ISQ::LengthValue = 0.6 [m];
        }

        part def Battery :> Component {
            attribute :>> mass = 120 [kg];
            attribute capacity : ISQ::EnergyValue;
            port supply : PowerPort;
        }

        part def Motor :> Component {
            attribute :>> mass = 45 [kg];
            port input : ~PowerPort;
            port control : CommandPort;
        }

        interface def PowerLink {
            end source : PowerPort;
            end sink : ~PowerPort;
        }

        abstract part def Car :> Component {
            attribute mode : Mode = Mode::standby;
            attribute maxSpeed : ISQ::SpeedValue;
            part wheels : Wheel [4];
            part battery : Battery [1];
            part motor : Motor [1..2];
            part spare : Wheel [0..1];
            ref part driver [0..1];
            interface : PowerLink connect battery.supply to motor.input;
            attribute totalMass :> ISQ::mass = Sum2(battery.mass, motor.mass);
            assert constraint budget : MassBudget {
                in total = totalMass;
                in limit = 1500 [kg];
            }
        }

        part def ElectricCar :> Car {
            attribute :>> maxSpeed default = 40 [m / s];
            part :>> motor [2];
            part :>> spare [0];
        }

        variation part def Trim {
            variant part basic : ElectricCar;
            variant part sport : ElectricCar {
                attribute :>> maxSpeed = 55 [m / s];
            }
        }
    }

    package Configurations {
        private import Structure::*;

        part myCar : ElectricCar {
            attribute :>> serial = "EV-0001";
            part :>> battery {
                attribute :>> capacity = 75 [kW * h];
                @Safety {
                    level = 3;
                }
            }
        }

        individual part def MyCarUnit :> ElectricCar;
    }
}
