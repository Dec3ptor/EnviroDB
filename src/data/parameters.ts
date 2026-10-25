import type { Parameter } from '../db/types';

// Built-in analyte dictionary. Names follow Hill Laboratories conventions where possible
// ("Total Ammoniacal-N", "Dissolved Zinc" …). Aliases are matched case/punctuation-insensitively
// and the user's own mappings are added as aliases over time.

type P = Omit<Parameter, 'builtIn' | 'order'>;

// Measured on site, listed first as in field sheets and monitoring tables.
const field: P[] = [
  { id: 'ph-field', name: 'pH (field)', group: 'Field', unit: 'pH', aliases: ['field pH', 'pH field', 'pH - field', 'pH (insitu)', 'in situ pH'], decimals: 1 },
  { id: 'temp', name: 'Temperature', short: 'Temp', group: 'Field', unit: '°C', aliases: ['temperature', 'temp', 'water temperature', 'water temp', 'field temperature', 'temperature (field)', 'temp (field)', 'temperature on site', 'site temperature'], decimals: 1 },
  { id: 'ec-field', name: 'Electrical Conductivity (field)', short: 'EC (field)', group: 'Field', unit: 'µS/cm', aliases: ['field ec', 'ec field', 'field conductivity', 'conductivity (field)', 'ec (field)', 'specific conductivity (field)'] },
  { id: 'do', name: 'Dissolved Oxygen', short: 'DO', group: 'Field', unit: 'mg/L', aliases: ['dissolved oxygen', 'do', 'do (mg/l)', 'dissolved oxygen (field)', 'do conc', 'oxygen dissolved', 'dissolved oxygen field test', 'dissolved oxygen (field test)'], decimals: 1 },
  { id: 'do-sat', name: 'Dissolved Oxygen Saturation', short: 'DO %', group: 'Field', unit: '% sat', aliases: ['do %', 'do saturation', 'dissolved oxygen saturation', '% do', 'do sat', 'dissolved oxygen (% saturation)', 'do (%)', 'oxygen saturation'], decimals: 0 },
  { id: 'turbidity-field', name: 'Turbidity (field)', short: 'Turb (field)', group: 'Field', unit: 'NTU', aliases: ['field turbidity', 'turbidity field', 'turbidity (field)'] },
  { id: 'orp', name: 'Redox Potential', short: 'ORP', group: 'Field', unit: 'mV', aliases: ['orp', 'redox', 'redox potential', 'oxidation reduction potential', 'eh'], decimals: 0 },
  { id: 'salinity', name: 'Salinity', group: 'Field', unit: 'ppt', aliases: ['salinity'] },
  { id: 'clarity', name: 'Visual Clarity', group: 'Field', unit: 'm', aliases: ['visual clarity', 'clarity', 'black disc', 'black disc clarity', 'water clarity'] },
  { id: 'flow', name: 'Flow', group: 'Field', unit: 'L/s', aliases: ['flow', 'flow rate', 'discharge rate', 'discharge volume rate'] },
  // a bore: the static water level is what's measured (down from the top of the casing); the rest follows from it
  { id: 'swl', name: 'Static Water Level', short: 'SWL', group: 'Field', unit: 'm', aliases: ['swl', 'static water level', 'groundwater level', 'water level', 'depth to water', 'dtw', 'depth to groundwater', 'depth to water (toc)', 'depth to water below toc', 'dtw (m btoc)', 'depth to water (m btoc)', 'water level (m btoc)', 'swl (m btoc)', 'm btoc', 'depth to water table', 'dtw (m)', 'swl (m)'], decimals: 2 },
  { id: 'stick-up', name: 'Casing Stick-up', group: 'Field', unit: 'm', aliases: ['stick-up', 'stickup', 'stick up', 'upstand', 'upstand height', 'casing height', 'casing stick-up', 'toc above ground', 'casing above ground'], decimals: 2 },
  { id: 'bore-depth', name: 'Bore Depth (measured)', group: 'Field', unit: 'm', aliases: ['bore depth', 'well depth', 'total depth', 'depth to bottom', 'measured depth', 'bore depth (measured)', 'depth of bore'], decimals: 2 },
  { id: 'dtw-bgl', name: 'Depth to Water (below ground)', short: 'DTW (bgl)', group: 'Field', unit: 'm', aliases: ['depth to water (bgl)', 'depth to water (m bgl)', 'water level (bgl)', 'water level (m bgl)', 'swl (m bgl)', 'm bgl', 'depth to water below ground', 'dtw bgl', 'depth below ground'], decimals: 2 },
  { id: 'gwl-rl', name: 'Groundwater Level (RL)', short: 'GWL (RL)', group: 'Field', unit: 'm', aliases: ['groundwater level (rl)', 'water level (rl)', 'swl (rl)', 'water level rl', 'reduced water level', 'gwl (m rl)', 'groundwater level (m rl)', 'groundwater rl', 'water level elevation', 'piezometric level'], decimals: 2 },
  { id: 'water-column', name: 'Water Column', group: 'Field', unit: 'm', aliases: ['water column', 'water column height', 'saturated thickness', 'height of water column'], decimals: 2 },
  { id: 'purge-vol', name: 'Purge Volume', group: 'Field', unit: 'L', aliases: ['purge volume', 'volume purged', 'purged volume', 'purge vol', 'purge (l)', 'volume purged (l)'], decimals: 1 },
];

// Laboratory physical measurements.
const physical: P[] = [
  { id: 'ph', name: 'pH', group: 'Physical', unit: 'pH', aliases: ['pH', 'pH (lab)', 'pH lab', 'lab pH', 'pH value', 'pH units', 'pH - Water', 'pH (water)'], decimals: 1 },
  { id: 'ec', name: 'Electrical Conductivity', short: 'EC', group: 'Physical', unit: 'µS/cm', aliases: ['electrical conductivity (ec)', 'electrical conductivity', 'conductivity', 'ec', 'specific conductance', 'spc', 'cond', 'conductivity (lab)', 'ec (lab)'] },
  { id: 'turbidity', name: 'Turbidity', short: 'Turb', group: 'Physical', unit: 'NTU', aliases: ['turbidity', 'turb', 'turbidity (lab)'] },
  { id: 'tss', name: 'Total Suspended Solids', short: 'TSS', group: 'Physical', unit: 'mg/L', aliases: ['total suspended solids', 'tss', 'suspended solids', 'ss', 'suspended solids (total)', 'total suspended solids (tss)', 'non-filterable residue', 'nfr'] },
  { id: 'vss', name: 'Volatile Suspended Solids', short: 'VSS', group: 'Physical', unit: 'mg/L', aliases: ['volatile suspended solids', 'vss', 'volatile suspended solids (vss)'] },
  { id: 'tds', name: 'Total Dissolved Solids', short: 'TDS', group: 'Physical', unit: 'mg/L', aliases: ['total dissolved solids', 'tds', 'total dissolved solids (tds)', 'dissolved solids'] },
  { id: 'colour-true', name: 'True Colour', short: 'Colour', group: 'Physical', unit: 'Hazen units', aliases: ['true colour', 'true hazen colour', 'true color', 'true hazen color', 'colour (true)', 'true colour (hazen)', 'hazen colour', 'colour', 'color'] },
];

const general: P[] = [
  { id: 'hardness', name: 'Total Hardness', short: 'Hardness', group: 'General chemistry', unit: 'mg/L', aliases: ['total hardness', 'hardness', 'hardness (as caco3)', 'total hardness as caco3', 'hardness as caco3', 'hardness (total)'] },
  { id: 'alkalinity', name: 'Total Alkalinity', short: 'Alkalinity', group: 'General chemistry', unit: 'mg/L', aliases: ['total alkalinity', 'alkalinity', 'alkalinity (total)', 'total alkalinity as caco3'] },
  { id: 'bicarbonate', name: 'Bicarbonate', short: 'HCO3', group: 'General chemistry', unit: 'mg/L', aliases: ['bicarbonate', 'hco3', 'bicarbonate as hco3'] },
  { id: 'co3', name: 'Carbonate', short: 'CO3', group: 'General chemistry', unit: 'mg/L', aliases: ['carbonate', 'co3', 'carbonate as caco3', 'carbonate (as caco3)', 'carbonate alkalinity'] },
  { id: 'cl', name: 'Chloride', short: 'Cl', group: 'General chemistry', unit: 'mg/L', aliases: ['chloride', 'cl', 'dissolved chloride'] },
  { id: 'so4', name: 'Sulphate', short: 'SO4', group: 'General chemistry', unit: 'mg/L', aliases: ['sulphate', 'sulfate', 'so4', 'dissolved sulphate', 'sulphate (so4)', 'sulfate (so4)'] },
  { id: 'f', name: 'Fluoride', short: 'F', group: 'General chemistry', unit: 'mg/L', aliases: ['fluoride', 'f'] },
  { id: 'br', name: 'Bromide', short: 'Br', group: 'General chemistry', unit: 'mg/L', aliases: ['bromide', 'br'] },
  { id: 'doc', name: 'Dissolved Organic Carbon', short: 'DOC', group: 'General chemistry', unit: 'mg/L', aliases: ['dissolved organic carbon', 'doc', 'dissolved organic carbon (doc)'] },
  { id: 'toc', name: 'Total Organic Carbon', short: 'TOC', group: 'General chemistry', unit: 'mg/L', aliases: ['total organic carbon', 'toc', 'total organic carbon (toc)'] },
  { id: 'bod5', name: 'Biochemical Oxygen Demand (BOD5)', short: 'BOD5', group: 'General chemistry', unit: 'mg/L', aliases: ['total biochemical oxygen demand (tbod5)', 'total biochemical oxygen demand', 'biochemical oxygen demand', 'bod5', 'bod', 'tbod5', 'bod 5', 'bod (5 day)', '5 day bod'] },
  { id: 'cbod5', name: 'Carbonaceous BOD (cBOD5)', short: 'cBOD5', group: 'General chemistry', unit: 'mg/L', aliases: ['carbonaceous biochemical oxygen demand (cbod5)', 'carbonaceous biochemical oxygen demand', 'cbod5', 'cbod', 'carbonaceous bod', 'total carbonaceous biochemical oxygen demand'] },
  { id: 'cod', name: 'Chemical Oxygen Demand', short: 'COD', group: 'General chemistry', unit: 'mg/L', aliases: ['total chemical oxygen demand (tcod)', 'total chemical oxygen demand', 'chemical oxygen demand', 'cod', 'tcod'] },
  { id: 'og', name: 'Oil and Grease', short: 'O&G', group: 'General chemistry', unit: 'mg/L', aliases: ['oil and grease', 'oil & grease', 'total oil and grease', 'o&g', 'oil grease', 'total oil & grease', 'fats oil and grease'] },
  { id: 'cn-t', name: 'Total Cyanide', short: 'CN (T)', group: 'General chemistry', unit: 'mg/L', aliases: ['total cyanide', 'cyanide', 'cyanide (total)', 'cn'] },
  { id: 'cn-wad', name: 'Weak Acid Dissociable Cyanide', short: 'CN (WAD)', group: 'General chemistry', unit: 'mg/L', aliases: ['weak acid dissociable cyanide', 'wad cyanide', 'cyanide (wad)', 'cn wad'] },
  { id: 'sulphide', name: 'Sulphide', short: 'S2-', group: 'General chemistry', unit: 'mg/L', aliases: ['sulphide', 'sulfide', 'total sulphide', 'total sulfide', 'hydrogen sulphide'] },
  { id: 'chlorine', name: 'Total Residual Chlorine', short: 'Cl2', group: 'General chemistry', unit: 'mg/L', aliases: ['total residual chlorine', 'chlorine', 'free available chlorine', 'total chlorine', 'residual chlorine'] },
];

const nutrients: P[] = [
  { id: 'nh3-free', name: 'Free Ammonia', short: 'NH3 (free)', group: 'Nutrients', unit: 'mg/L', aliases: ['free ammonia', 'free ammonia (nh3)', 'un-ionised ammonia', 'unionised ammonia', 'un-ionized ammonia', 'unionized ammonia', 'nh3 (free)', 'free ammonia-n', 'free ammonia as n'] },
  { id: 'nh4-n', name: 'Total Ammoniacal-N', short: 'NH4-N', group: 'Nutrients', unit: 'mg/L', aliases: ['total ammoniacal-n', 'total ammoniacal n', 'ammoniacal nitrogen', 'ammoniacal-n', 'ammonia-n', 'ammonia n', 'nh4-n', 'nh4 n', 'nh3-n', 'nh4', 'ammonia', 'ammonium', 'ammonium-n', 'ammonium n', 'ammonia (as n)', 'total ammonia-n', 'total ammonia', 'ammonia nitrogen', 'ammoniacal n'] },
  { id: 'no3-n', name: 'Nitrate-N', short: 'NO3-N', group: 'Nutrients', unit: 'mg/L', aliases: ['nitrate-n', 'nitrate n', 'nitrate nitrogen', 'no3-n', 'no3 n', 'nitrate', 'nitrate (as n)', 'no3'] },
  { id: 'no2-n', name: 'Nitrite-N', short: 'NO2-N', group: 'Nutrients', unit: 'mg/L', aliases: ['nitrite-n', 'nitrite n', 'nitrite nitrogen', 'no2-n', 'no2 n', 'nitrite', 'nitrite (as n)', 'no2'] },
  { id: 'nnn', name: 'Nitrate-N + Nitrite-N', short: 'NNN', group: 'Nutrients', unit: 'mg/L', aliases: ['nitrate-n + nitrite-n', 'nitrate n nitrite n', 'nnn', 'nox-n', 'nox', 'total oxidised nitrogen', 'total oxidized nitrogen', 'ton', 'nitrate + nitrite', 'no3+no2-n', 'nitrite-n + nitrate-n', 'nitrate + nitrite nitrogen', 'oxidised nitrogen'] },
  { id: 'tkn', name: 'Total Kjeldahl Nitrogen', short: 'TKN', group: 'Nutrients', unit: 'mg/L', aliases: ['total kjeldahl nitrogen (tkn)', 'total kjeldahl nitrogen', 'tkn', 'kjeldahl nitrogen'] },
  { id: 'tn', name: 'Total Nitrogen', short: 'TN', group: 'Nutrients', unit: 'mg/L', aliases: ['total nitrogen', 'tn', 'nitrogen (total)', 'total n'] },
  { id: 'drp', name: 'Dissolved Reactive Phosphorus', short: 'DRP', group: 'Nutrients', unit: 'mg/L', aliases: ['dissolved reactive phosphorus', 'drp', 'orthophosphate', 'ortho-phosphate', 'ortho-p', 'soluble reactive phosphorus', 'srp', 'po4-p', 'filterable reactive phosphorus', 'frp', 'reactive phosphorus'] },
  { id: 'tp', name: 'Total Phosphorus', short: 'TP', group: 'Nutrients', unit: 'mg/L', aliases: ['total phosphorus', 'tp', 'phosphorus (total)', 'total p'] },
  { id: 'chla', name: 'Chlorophyll a', short: 'Chl a', group: 'Nutrients', unit: 'mg/m³', aliases: ['chlorophyll a', 'chlorophyll-a', 'chl a', 'chla', 'chlorophyll'] },
];

const micro: P[] = [
  { id: 'ecoli', name: 'E. coli', group: 'Microbiology', unit: 'cfu/100mL', aliases: ['escherichia coli', 'e. coli', 'e.coli', 'e coli', 'ecoli', 'e-coli'], decimals: 0 },
  { id: 'fc', name: 'Faecal Coliforms', group: 'Microbiology', unit: 'cfu/100mL', aliases: ['faecal coliforms', 'fecal coliforms', 'thermotolerant coliforms', 'faecal coliform', 'fc'], decimals: 0 },
  { id: 'tc', name: 'Total Coliforms', group: 'Microbiology', unit: 'cfu/100mL', aliases: ['total coliforms', 'coliforms', 'total coliform'], decimals: 0 },
  { id: 'entero', name: 'Enterococci', group: 'Microbiology', unit: 'cfu/100mL', aliases: ['enterococci', 'enterococcus', 'faecal enterococci'], decimals: 0 },
];

// Metals – generated for dissolved and total fractions.
// [symbol, name, hardnessExponent?] – exponents from ANZECC & ARMCANZ (2000) Table 3.4.4.
const METALS: Array<[string, string, number?]> = [
  ['Al', 'Aluminium'],
  ['Sb', 'Antimony'],
  ['As', 'Arsenic'],
  ['Ba', 'Barium'],
  ['Be', 'Beryllium'],
  ['B', 'Boron'],
  ['Cd', 'Cadmium', 0.89],
  ['Ca', 'Calcium'],
  ['Cr', 'Chromium', 0.82],
  ['Co', 'Cobalt'],
  ['Cu', 'Copper', 0.85],
  ['Fe', 'Iron'],
  ['Pb', 'Lead', 1.27],
  ['Li', 'Lithium'],
  ['Mg', 'Magnesium'],
  ['Mn', 'Manganese'],
  ['Hg', 'Mercury'],
  ['Mo', 'Molybdenum'],
  ['Ni', 'Nickel', 0.85],
  ['K', 'Potassium'],
  ['Se', 'Selenium'],
  ['Ag', 'Silver'],
  ['Na', 'Sodium'],
  ['Sr', 'Strontium'],
  ['Tl', 'Thallium'],
  ['Sn', 'Tin'],
  ['U', 'Uranium'],
  ['V', 'Vanadium'],
  ['Zn', 'Zinc', 0.85],
];

const ALT_NAMES: Record<string, string[]> = { Aluminium: ['aluminum'], Sulphur: ['sulfur'] };

/**
 * Names built-in parameters went by before and no longer do: "acid soluble zinc" was taken as total zinc, but the
 * acid-soluble fraction is a different measurement (now a parameter of its own). Taken off existing libraries.
 */
export const RETIRED_ALIASES: Record<string, string[]> = {};

/** Short names built-in parameters had before, put right in existing libraries ("As (AS)" read as arsenic twice). */
export const RETIRED_SHORT: Record<string, string> = {};

/** Names built-in parameters had before, put right in existing libraries (the static water level was "Groundwater Level"). */
export const RETIRED_NAMES: Record<string, string[]> = { swl: ['Groundwater Level'] };
// the level's RL names went with it before 1.27; they belong to the groundwater level (RL)
RETIRED_ALIASES.swl = ['groundwater level (rl)', 'water level (rl)', 'swl (rl)', 'water level rl', 'reduced water level'];

/** Built-in parameters that no longer exist: taken out of a library when nothing uses them (1.24–1.26 had a separate "Depth to Water"). */
export const RETIRED_PARAMETERS = ['dtw'];

function metalParams(): P[] {
  const out: P[] = [];
  for (const [sym, name, exp] of METALS) {
    const s = sym.toLowerCase();
    const names = [name.toLowerCase(), ...(ALT_NAMES[name] ?? [])];
    const dAliases: string[] = [];
    const tAliases: string[] = [];
    const aAliases: string[] = [];
    for (const n of [...names, s]) {
      // dissolved: filtered (0.45 µm) – which some labs call "soluble"
      dAliases.push(`dissolved ${n}`, `${n} dissolved`, `${n} (dissolved)`, `${n} - dissolved`, `${n}, dissolved`, `diss ${n}`, `${n} (diss)`, `${n} diss`, `${n} (filtered)`, `filtered ${n}`, `${n}-d`, `${n} (d)`, `${n}_d`, `soluble ${n}`, `${n} soluble`, `${n} (soluble)`, `${n} - soluble`, `${n}, soluble`);
      tAliases.push(`total ${n}`, `${n} total`, `${n} (total)`, `${n} - total`, `${n}, total`, `total recoverable ${n}`, `${n} (total recoverable)`, `${n} total recoverable`, `tot ${n}`, `${n} (tot)`, `${n} (unfiltered)`, `${n}-t`, `${n} (t)`, `${n}_t`);
      // acid soluble: unfiltered, acidified but not digested – between dissolved and total recoverable
      aAliases.push(`acid soluble ${n}`, `${n} acid soluble`, `${n} (acid soluble)`, `${n} - acid soluble`, `${n}, acid soluble`, `acid-soluble ${n}`, `${n} (acid-soluble)`, `acid sol ${n}`, `${n} (acid sol)`, `acid extractable ${n}`, `${n} (acid extractable)`);
    }
    RETIRED_SHORT[`${s}-as`] = `${sym} (AS)`;
    for (const a of aAliases) if (/^acid soluble |\(acid soluble\)$/.test(a)) (RETIRED_ALIASES[`${s}-t`] ??= []).push(a);
    out.push({
      id: `${s}-d`,
      name: `Dissolved ${name}`,
      short: `${sym} (D)`,
      group: 'Metals (dissolved)',
      unit: 'mg/L',
      aliases: dAliases,
      hardnessExponent: exp,
    });
    out.push({
      id: `${s}-t`,
      name: `Total ${name}`,
      short: `${sym} (T)`,
      group: 'Metals (total)',
      unit: 'mg/L',
      aliases: tAliases,
      hardnessExponent: exp,
    });
    out.push({
      id: `${s}-as`,
      name: `Acid Soluble ${name}`,
      short: `${sym} (acid sol)`,
      group: 'Metals (acid soluble)',
      unit: 'mg/L',
      aliases: aAliases,
      hardnessExponent: exp,
    });
  }
  return out;
}

const hydrocarbons: P[] = [
  { id: 'tph-c7-c9', name: 'TPH C7–C9', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['c7 - c9', 'c7-c9', 'tph c7-c9', 'c7 to c9', 'tph (c7-c9)', 'total petroleum hydrocarbons c7-c9', 'c7-c9 fraction'] },
  { id: 'tph-c10-c14', name: 'TPH C10–C14', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['c10 - c14', 'c10-c14', 'tph c10-c14', 'c10 to c14', 'tph (c10-c14)', 'total petroleum hydrocarbons c10-c14', 'c10-c14 fraction'] },
  { id: 'tph-c15-c36', name: 'TPH C15–C36', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['c15 - c36', 'c15-c36', 'tph c15-c36', 'c15 to c36', 'tph (c15-c36)', 'total petroleum hydrocarbons c15-c36', 'c15-c36 fraction'] },
  { id: 'tph-total', name: 'Total Petroleum Hydrocarbons (C7–C36)', short: 'TPH', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['total hydrocarbons (c7 - c36)', 'total hydrocarbons', 'tph', 'total petroleum hydrocarbons', 'c7-c36', 'total hydrocarbons c7-c36', 'tph (c7-c36)', 'tph total'] },
  { id: 'benzene', name: 'Benzene', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['benzene'] },
  { id: 'toluene', name: 'Toluene', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['toluene'] },
  { id: 'ethylbenzene', name: 'Ethylbenzene', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['ethylbenzene', 'ethyl benzene'] },
  { id: 'xylene-mp', name: 'm&p-Xylene', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['m&p-xylene', 'm+p-xylene', 'm,p-xylene', 'm and p xylene', 'm/p-xylene', 'mp-xylene'] },
  { id: 'xylene-o', name: 'o-Xylene', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['o-xylene', 'o xylene', 'ortho-xylene'] },
  { id: 'xylenes', name: 'Total Xylenes', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['total xylenes', 'xylenes', 'xylene (total)', 'xylene'] },
  { id: 'naphthalene', name: 'Naphthalene', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['naphthalene'] },
  { id: 'bap', name: 'Benzo[a]pyrene', short: 'BaP', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['benzo[a]pyrene (bap)', 'benzo[a]pyrene', 'benzo(a)pyrene', 'bap', 'benzo a pyrene'] },
  { id: 'phenol', name: 'Phenol', group: 'Hydrocarbons', unit: 'mg/L', aliases: ['phenol', 'phenols', 'total phenols'] },
];

const pfas: P[] = [
  { id: 'pfos', name: 'PFOS', group: 'PFAS', unit: 'µg/L', aliases: ['pfos', 'perfluorooctane sulfonate', 'perfluorooctanesulfonic acid', 'perfluorooctane sulphonate'] },
  { id: 'pfoa', name: 'PFOA', group: 'PFAS', unit: 'µg/L', aliases: ['pfoa', 'perfluorooctanoic acid', 'perfluorooctanoate'] },
  { id: 'pfhxs', name: 'PFHxS', group: 'PFAS', unit: 'µg/L', aliases: ['pfhxs', 'perfluorohexane sulfonate', 'perfluorohexanesulfonic acid', 'perfluorohexane sulphonate'] },
];

// Stream ecology – scored for the NPS-FM attributes.
const ecology: P[] = [
  { id: 'peri-chla', name: 'Periphyton Chlorophyll a', short: 'Peri chl a', group: 'Ecology', unit: 'mg/m²', aliases: ['periphyton chlorophyll a', 'periphyton chlorophyll-a', 'periphyton chl a', 'benthic chlorophyll a', 'periphyton biomass (chl a)', 'chlorophyll a (periphyton)'] },
  { id: 'mci', name: 'Macroinvertebrate Community Index', short: 'MCI', group: 'Ecology', unit: '', aliases: ['mci', 'macroinvertebrate community index', 'mci score', 'hard-bottom mci', 'sb-mci', 'soft-bottom mci'], decimals: 0 },
  { id: 'qmci', name: 'Quantitative MCI', short: 'QMCI', group: 'Ecology', unit: '', aliases: ['qmci', 'quantitative macroinvertebrate community index', 'quantitative mci', 'qmci score', 'sb-qmci'], decimals: 2 },
  { id: 'aspm', name: 'Average Score Per Metric', short: 'ASPM', group: 'Ecology', unit: '', aliases: ['aspm', 'average score per metric', 'aspm score'], decimals: 2 },
];

const chromium6: P = {
  id: 'cr6',
  name: 'Hexavalent Chromium',
  short: 'Cr(VI)',
  group: 'Metals (dissolved)',
  unit: 'mg/L',
  aliases: ['hexavalent chromium', 'chromium - hexavalent', 'chromium hexavalent', 'chromium (vi)', 'chromium vi', 'cr(vi)', 'cr vi', 'cr6+', 'cr6', 'cr (vi)', 'hexavalent chromium (cr6+)'],
};

// dissolved metals together, then total, then acid soluble (the generator gives each metal's fractions in turn)
const metals = metalParams();
export const BUILT_IN_PARAMETERS: Parameter[] = [
  ...field,
  ...physical,
  ...general,
  ...nutrients,
  ...micro,
  ...metals.filter((p) => p.group === 'Metals (dissolved)'),
  chromium6,
  ...metals.filter((p) => p.group === 'Metals (total)'),
  ...metals.filter((p) => p.group === 'Metals (acid soluble)'),
  ...hydrocarbons,
  ...pfas,
  ...ecology,
].map((p, i) => ({ ...p, builtIn: true, order: i }));

/** Parameter groups in the order they are listed everywhere: field measurements first, then the laboratory groups. */
export const PARAMETER_GROUPS = ['Field', 'Physical', 'General chemistry', 'Nutrients', 'Microbiology', 'Metals (dissolved)', 'Metals (total)', 'Metals (acid soluble)', 'Hydrocarbons', 'Pesticides', 'Other organics', 'PFAS', 'Ecology', 'Other'];

const PESTICIDE = /\b(DD[DET]|BHC|HCH|lindane|aldrin|dieldrin|endrin|endosulfan|heptachlor|chlordane|methoxychlor|hexachlorobenzene|mirex|toxaphene|atrazine|simazine|glyphosate|2,4-D|MCPA|triclopyr|picloram|chlorpyrifos|diazinon|pesticide|herbicide)\b/i;
const PAH = /naphthalene|anthracene|phenanthrene|pyrene|fluoranthene|fluorene|chrysene|acenaphth|perylene|benzo\s*[([]|indeno|\bPAH|TEQ|aromatic hydrocarbon/i;
const PETROLEUM = /\bTPH\b|hydrocarbon|\bC\d{1,2}\s*[-–]\s*C\d{1,2}\b|\bbenzene$|toluene|xylene|ethylbenzene|\bBTEX\b/i;
const PFAS_RE = /\bPF[A-Z]{2,5}\b|perfluoro|fluorotelomer|\bFTS\b/i;
const ORGANIC = /phenol|phthalate|adipate|chloro|bromo|nitro|ether|amine|aniline|benz|toluene|ethane|ethene|methane|propane|butadiene|isophorone|furan|alcohol|sulfonate|sulphonate|organic|SVOC|VOC|semi-volatile/i;

/** The group a parameter added from a lab file most likely belongs in, from its name and the report's section. */
export function guessGroup(name: string, section = ''): string {
  const t = `${name} ${section}`;
  if (PFAS_RE.test(t)) return 'PFAS';
  if (PESTICIDE.test(name) || /pesticide|organochlorine|organophosph/i.test(section)) return 'Pesticides';
  if (PAH.test(name) || PETROLEUM.test(name) || /aromatic hydrocarbon|petroleum|\bBTEX\b|\bTPH\b/i.test(section)) return 'Hydrocarbons';
  if (ORGANIC.test(t)) return 'Other organics';
  return 'Other';
}

const GROUP_RANK = new Map(PARAMETER_GROUPS.map((g, i) => [g, i]));

/** The logical order for parameters: by group (see PARAMETER_GROUPS), then their place in the group, then name. */
export function compareParams(a: Pick<Parameter, 'group' | 'order' | 'name'>, b: Pick<Parameter, 'group' | 'order' | 'name'>): number {
  const rank = (p: Pick<Parameter, 'group'>) => GROUP_RANK.get(p.group) ?? GROUP_RANK.get('Other')!;
  return rank(a) - rank(b) || (a.order ?? 99999) - (b.order ?? 99999) || a.name.localeCompare(b.name);
}

/** The group for a parameter still in the old combined "Physical & field" group. */
export function splitPhysicalAndField(p: Pick<Parameter, 'id' | 'name'>): string {
  const builtIn = BUILT_IN_PARAMETERS.find((x) => x.id === p.id);
  if (builtIn) return builtIn.group;
  return /\bfield\b|in.?situ/i.test(p.name) ? 'Field' : 'Physical';
}

/** Element symbol / name lookup used by the fuzzy matcher. */
export const ELEMENT_NAMES: Record<string, string> = Object.fromEntries(
  METALS.flatMap(([sym, name]) => [
    [sym.toLowerCase(), name.toLowerCase()],
    ...(ALT_NAMES[name] ?? []).map((a) => [a, name.toLowerCase()]),
  ]),
);
