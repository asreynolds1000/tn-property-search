/**
 * Tennessee county reference table.
 *
 * `jur` is the 3-digit jurisdiction code TPAD uses. It is also the COUNTY_ID
 * (unpadded) in the TNMap statewide parcel layer, so '030' <-> 30.
 *
 * `tpad: false` marks the nine counties that run their own CAMA systems.
 * TPAD lists them in its county dropdown but disables search and links out
 * instead, so a search for those must route to a county adapter.
 *
 * Source of truth: the county <select> on https://assessment.cot.tn.gov/TPAD/
 * (captured 2026-08-29). To refresh, re-scrape that <select>; the nine
 * non-TPAD counties are the options labelled "(external link)".
 */

export interface County {
  /** 3-digit TPAD jurisdiction code, zero-padded. */
  jur: string;
  name: string;
  /** True when TPAD serves this county's assessment data directly. */
  tpad: boolean;
}

export const COUNTIES: readonly County[] = [
  { jur: '001', name: 'Anderson', tpad: true },
  { jur: '002', name: 'Bedford', tpad: true },
  { jur: '003', name: 'Benton', tpad: true },
  { jur: '004', name: 'Bledsoe', tpad: true },
  { jur: '005', name: 'Blount', tpad: true },
  { jur: '006', name: 'Bradley', tpad: true },
  { jur: '007', name: 'Campbell', tpad: true },
  { jur: '008', name: 'Cannon', tpad: true },
  { jur: '009', name: 'Carroll', tpad: true },
  { jur: '010', name: 'Carter', tpad: true },
  { jur: '011', name: 'Cheatham', tpad: true },
  { jur: '012', name: 'Chester', tpad: false },
  { jur: '013', name: 'Claiborne', tpad: true },
  { jur: '014', name: 'Clay', tpad: true },
  { jur: '015', name: 'Cocke', tpad: true },
  { jur: '016', name: 'Coffee', tpad: true },
  { jur: '017', name: 'Crockett', tpad: true },
  { jur: '018', name: 'Cumberland', tpad: true },
  { jur: '019', name: 'Davidson', tpad: false },
  { jur: '020', name: 'Decatur', tpad: true },
  { jur: '021', name: 'DeKalb', tpad: true },
  { jur: '022', name: 'Dickson', tpad: true },
  { jur: '023', name: 'Dyer', tpad: true },
  { jur: '024', name: 'Fayette', tpad: true },
  { jur: '025', name: 'Fentress', tpad: true },
  { jur: '026', name: 'Franklin', tpad: true },
  { jur: '027', name: 'Gibson', tpad: true },
  { jur: '028', name: 'Giles', tpad: true },
  { jur: '029', name: 'Grainger', tpad: true },
  { jur: '030', name: 'Greene', tpad: true },
  { jur: '031', name: 'Grundy', tpad: true },
  { jur: '032', name: 'Hamblen', tpad: true },
  { jur: '033', name: 'Hamilton', tpad: false },
  { jur: '034', name: 'Hancock', tpad: true },
  { jur: '035', name: 'Hardeman', tpad: true },
  { jur: '036', name: 'Hardin', tpad: true },
  { jur: '037', name: 'Hawkins', tpad: true },
  { jur: '038', name: 'Haywood', tpad: true },
  { jur: '039', name: 'Henderson', tpad: true },
  { jur: '040', name: 'Henry', tpad: true },
  { jur: '041', name: 'Hickman', tpad: false },
  { jur: '042', name: 'Houston', tpad: true },
  { jur: '043', name: 'Humphreys', tpad: true },
  { jur: '044', name: 'Jackson', tpad: true },
  { jur: '045', name: 'Jefferson', tpad: true },
  { jur: '046', name: 'Johnson', tpad: true },
  { jur: '047', name: 'Knox', tpad: false },
  { jur: '048', name: 'Lake', tpad: true },
  { jur: '049', name: 'Lauderdale', tpad: true },
  { jur: '050', name: 'Lawrence', tpad: true },
  { jur: '051', name: 'Lewis', tpad: true },
  { jur: '052', name: 'Lincoln', tpad: true },
  { jur: '053', name: 'Loudon', tpad: true },
  { jur: '054', name: 'McMinn', tpad: true },
  { jur: '055', name: 'McNairy', tpad: true },
  { jur: '056', name: 'Macon', tpad: true },
  { jur: '057', name: 'Madison', tpad: true },
  { jur: '058', name: 'Marion', tpad: true },
  { jur: '059', name: 'Marshall', tpad: true },
  { jur: '060', name: 'Maury', tpad: true },
  { jur: '061', name: 'Meigs', tpad: true },
  { jur: '062', name: 'Monroe', tpad: true },
  { jur: '063', name: 'Montgomery', tpad: false },
  { jur: '064', name: 'Moore', tpad: true },
  { jur: '065', name: 'Morgan', tpad: true },
  { jur: '066', name: 'Obion', tpad: true },
  { jur: '067', name: 'Overton', tpad: true },
  { jur: '068', name: 'Perry', tpad: true },
  { jur: '069', name: 'Pickett', tpad: true },
  { jur: '070', name: 'Polk', tpad: true },
  { jur: '071', name: 'Putnam', tpad: true },
  { jur: '072', name: 'Rhea', tpad: true },
  { jur: '073', name: 'Roane', tpad: true },
  { jur: '074', name: 'Robertson', tpad: true },
  { jur: '075', name: 'Rutherford', tpad: false },
  { jur: '076', name: 'Scott', tpad: true },
  { jur: '077', name: 'Sequatchie', tpad: true },
  { jur: '078', name: 'Sevier', tpad: true },
  { jur: '079', name: 'Shelby', tpad: false },
  { jur: '080', name: 'Smith', tpad: true },
  { jur: '081', name: 'Stewart', tpad: true },
  { jur: '082', name: 'Sullivan', tpad: true },
  { jur: '083', name: 'Sumner', tpad: true },
  { jur: '084', name: 'Tipton', tpad: true },
  { jur: '085', name: 'Trousdale', tpad: true },
  { jur: '086', name: 'Unicoi', tpad: true },
  { jur: '087', name: 'Union', tpad: true },
  { jur: '088', name: 'Van Buren', tpad: true },
  { jur: '089', name: 'Warren', tpad: true },
  { jur: '090', name: 'Washington', tpad: true },
  { jur: '091', name: 'Wayne', tpad: true },
  { jur: '092', name: 'Weakley', tpad: true },
  { jur: '093', name: 'White', tpad: true },
  { jur: '094', name: 'Williamson', tpad: false },
  { jur: '095', name: 'Wilson', tpad: true },] as const;

/** Counties TPAD does not serve; each needs its own AssessmentProvider. */
export const NON_TPAD_JURS: readonly string[] = COUNTIES.filter((c) => !c.tpad).map((c) => c.jur);

const BY_JUR = new Map(COUNTIES.map((c) => [c.jur, c]));
const BY_NAME = new Map(COUNTIES.map((c) => [c.name.toLowerCase(), c]));

/** Accepts '030', '30', 30, or 'Greene'. Returns undefined if unknown. */
export function resolveCounty(input: string | number): County | undefined {
  const raw = String(input).trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return BY_JUR.get(raw.padStart(3, '0'));
  return BY_NAME.get(raw.toLowerCase().replace(/\s+county$/i, ''));
}
