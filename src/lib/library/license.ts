/**
 * Licences of the library files the app shows. The standard library comes
 * from the sysml-toolkit's bundle (`static/toolkit/stdlib/`), which carries
 * the SysML v2 Release's library source unmodified under EPL-2.0; the
 * toolkit's own packages in that bundle are Apache-2.0.
 */
import type { LibraryLicense } from '#lib/engine/types.ts';
import { isStandardFile } from './catalog';

/** The SysML v2 Release revision the toolkit bundles (its THIRD-PARTY-NOTICES.md). */
export const LIBRARY_REVISION = 'de1070ae8e79c21532b8004fc663d47b35d0e9fa';
const SOURCE = 'https://github.com/Systems-Modeling/SysML-v2-Release';

const NOTICE = `The OMG SysML v2 and KerML standard library (the KerML and SysML model libraries) is included unmodified from the SysML v2 Release, ${SOURCE}, at revision ${LIBRARY_REVISION}, as bundled by the Open-MBEE sysml-toolkit. It is licensed by the respective copyright holders listed below under the Eclipse Public License 2.0 (EPL-2.0).

Copyright © 2019-2021 California Institute of Technology (Jet Propulsion Laboratory)
Copyright © 2019-2026 DEKonsult
Copyright © 2019-2021 IncQuery Labs Ltd.
Copyright © 2019-2026 Intercax LLC
Copyright © 2019-2021 Itemis
Copyright © 2019-2026 Mgnite Inc.
Copyright © 2019-2026 Model Driven Solutions, Inc.
Copyright © 2019-2026 SAF Consulting
Copyright © 2022 Siemens AG
Copyright © 2021-2025 Twingineer LLC`;

/** The standard library's licence. */
export const libraryLicense: LibraryLicense = {
	spdx: 'EPL-2.0',
	notice: NOTICE,
	source: `${SOURCE}/tree/${LIBRARY_REVISION}`,
	licenseUrl: 'https://www.eclipse.org/legal/epl-2.0/'
};

/** The toolkit's own packages, loaded after the standard library. */
const toolkitLicense: LibraryLicense = {
	spdx: 'Apache-2.0',
	notice:
		'This package is part of the Open-MBEE sysml-toolkit, not of the OMG standard library. It is licensed under the Apache License 2.0.',
	source: 'https://github.com/Open-MBEE/sysml-toolkit',
	licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0'
};

/** The licence of one library file. */
export function licenseFor(path: string): LibraryLicense {
	return isStandardFile(path) ? libraryLicense : toolkitLicense;
}
