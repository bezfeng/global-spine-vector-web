import { loadPyodide } from "pyodide";

export const levelProportion = {
  C1: 1,
  C2: 1,
  C3: 1,
  C4: 1,
  C5: 1,
  C6: 1,
  C7: 1,
  T1: 1.1,
  T2: 1.1,
  T3: 1.4,
  T4: 1.3,
  T5: 1.3,
  T6: 1.3,
  T7: 1.4,
  T8: 1.5,
  T9: 1.6,
  T10: 2.0,
  T11: 2.1,
  T12: 2.5,
  L1: 2.4,
  L2: 2.4,
  L3: 2.3,
  L4: 2.6,
  L5: 2.6,
  S1: 2.6,
};

export const cervicalLevels = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"];
export const thoracicLevels = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "T8",
  "T9",
  "T10",
  "T11",
  "T12",
];
export const lumbarLevels = ["L1", "L2", "L3", "L4", "L5", "S1"];

export const validLevels = new Set(
  [cervicalLevels, thoracicLevels, lumbarLevels].flat()
);

export async function makePyodide() {
  console.log("Loading Pyodide...");

  let newPyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
  });
  await newPyodide.loadPackage(["numpy", "scipy"]);

  // Set up our imports and helper functions.
  await newPyodide.runPythonAsync(`
    import numpy as np
    import scipy
    from scipy.interpolate import CubicSpline

    def calculate_angles(spline, x_values):
      dx = spline.derivative(1)(x_values)  # First derivative
      dy = np.ones_like(dx)
      tangent_vectors = np.stack((dx, dy), axis=-1)
      normalized_tangent_vectors = tangent_vectors / np.linalg.norm(tangent_vectors, axis=-1, keepdims=True)
      angles = np.arctan2(normalized_tangent_vectors[:, 0], normalized_tangent_vectors[:, 1])
      return np.degrees(angles)
    
    def calculate_vector(weight, level, angle):
      print('Calculating vector for {}, {}, {}'.format(weight, level, angle))
      return np.abs(scipy.constants.g * weight * np.sin(np.radians(angle)) * level/58)
    def calculate_vector_normal(weight, level, angle):
      return np.abs(scipy.constants.g * weight * np.cos(np.radians(angle)) * level/58)

    def calculate_vector_S_non_abs(weight, level, angle):
      return scipy.constants.g * weight * np.sin(np.radians(angle)) * level/58
    def calculate_vector_O_non_abs(weight, level, angle):
      return scipy.constants.g * weight * np.cos(np.radians(angle)) * level/58
  `);
  return newPyodide;
}

export const calcCumLevel = () => {
  let cumulativeLevelProportion = {};
  let cumulativeSingleLevelProportion = {};

  let totalHeadContribution = 7;
  let totalCervicalContribution = 4;
  let totalWeightOnLumbar = 65;
  let totalTrunkUpperExtremitiesContributions =
    totalWeightOnLumbar - totalHeadContribution - totalCervicalContribution;

  let cervicalList = cervicalLevels;
  let thoracicLumbarList = [thoracicLevels, lumbarLevels].flat();

  let sumCervicalRegionalContribution = 0;
  cervicalList.forEach((l) => {
    sumCervicalRegionalContribution += levelProportion[l];
  });

  cervicalList.forEach((l) => {
    cumulativeLevelProportion[l] =
      levelProportion[l] / sumCervicalRegionalContribution;
    cumulativeSingleLevelProportion[l] =
      levelProportion[l] / sumCervicalRegionalContribution;
  });

  let priorCContrib = totalHeadContribution;

  cervicalList.forEach((l) => {
    cumulativeLevelProportion[l] =
      priorCContrib + totalCervicalContribution * cumulativeLevelProportion[l];
    cumulativeSingleLevelProportion[l] =
      totalCervicalContribution * cumulativeSingleLevelProportion[l];
  });

  let sumThoracicLumbarRegionalContribution = 0;
  thoracicLumbarList.forEach((l) => {
    sumThoracicLumbarRegionalContribution += levelProportion[l];
  });
  thoracicLumbarList.forEach((l) => {
    cumulativeLevelProportion[l] =
      levelProportion[l] / sumThoracicLumbarRegionalContribution;
    cumulativeSingleLevelProportion[l] =
      levelProportion[l] / sumThoracicLumbarRegionalContribution;
  });
  let priorTLContrib = totalHeadContribution + totalCervicalContribution;
  thoracicLumbarList.forEach((l) => {
    cumulativeLevelProportion[l] =
      priorTLContrib +
      totalTrunkUpperExtremitiesContributions * cumulativeLevelProportion[l];
    cumulativeSingleLevelProportion[l] =
      totalTrunkUpperExtremitiesContributions *
      cumulativeSingleLevelProportion[l];
    priorTLContrib = cumulativeLevelProportion[l];
  });

  return {
    cumulativeLevelProportion: cumulativeLevelProportion,
    cumulativeSingleLevelProportion: cumulativeSingleLevelProportion,
    cervicalList: cervicalList,
    thoracicLumbarList: thoracicLumbarList,
  };
};

export function calcSpineVector(pyodide, coordinates, weightString) {
  if (coordinates.length == 0) {
    return null;
  }

  let sortedCoords = [...coordinates];
  sortedCoords.sort((a, b) => {
    return a.y < b.y ? -1 : 1;
  });
  globalThis.xVals = sortedCoords.map((c) => c.x);
  globalThis.yVals = sortedCoords.map((c) => c.y);

  // Default to a weight of 60 kg.
  let weight = 60.0;
  if (weightString) {
    weight = Number.parseFloat(weightString);
  } else {
    return null;
  }

  console.log("Performing calculations with weight of " + weight);

  let levelParams = calcCumLevel();

  // In order to bridge JS objects into Pyodide, we have to assign them
  // to the global scope.
  globalThis.w = weight;
  globalThis.level = sortedCoords.map((c) => c.label);

  globalThis.cumulativeLevelProportion = levelParams.cumulativeLevelProportion;
  globalThis.cumulativeSingleLevelProportion =
    levelParams.cumulativeSingleLevelProportion;
  globalThis.cervicalLevels = cervicalLevels;
  globalThis.thoracicLevels = thoracicLevels;
  globalThis.lumbarLevels = lumbarLevels;

  // Make sure the labels are spinal levels (not arbitrary text) and that we have at least two
  // cervical, thoracic, and lumbar points. Otherwise, the vector calculations will fail.
  let numCervicalLabels = 0;
  let numThoracicLevels = 0;
  let numLumbarLevels = 0;
  for (let i = 0; i < sortedCoords.length; i++) {
    let label = sortedCoords[i].label;
    if (cervicalLevels.includes(label)) {
      numCervicalLabels += 1;
    } else if (thoracicLevels.includes(label)) {
      numThoracicLevels += 1;
    } else if (lumbarLevels.includes(label)) {
      numLumbarLevels += 1;
    }
  }
  if (numCervicalLabels < 2 || numThoracicLevels < 2 || numLumbarLevels < 2) {
    return null;
  }

  pyodide.runPython(`
    import js

    # Load in instance variables bridged from JS
    w = js.w
    level = js.level.to_py()

    # Set up constants (also bridged from JS)
    cumulative_level_proportion = js.cumulativeLevelProportion.to_py()
    cumulative_single_level_proportion = js.cumulativeSingleLevelProportion.to_py()
    cervical_levels = js.cervicalLevels.to_py()
    thoracic_levels = js.thoracicLevels.to_py()
    lumbar_levels = js.lumbarLevels.to_py()
  
    y = np.asarray(js.yVals.to_py())
    x = np.asarray(js.xVals.to_py())
    cs = CubicSpline(y, x, bc_type='natural')   

    angles = calculate_angles(cs, y)
    
    vec_mag = [calculate_vector(w, cumulative_single_level_proportion[l], a) for a, l in zip(angles, level)]
    vec_mag_normal = [calculate_vector_normal(w, cumulative_single_level_proportion[l], a) for a, l in
                zip(angles, level)]

    vec_mag_S_non_abs = [calculate_vector_S_non_abs(w, cumulative_level_proportion[l], a) for a, l in zip(angles, level)]
    vec_mag_O_non_abs = [calculate_vector_O_non_abs(w, cumulative_level_proportion[l], a) for a, l in zip(angles, level)]

    # Determine x and y vectors for each labeled spinal level
    x_e = [m * np.cos(np.radians(ang)) if np.radians(ang) < 0 else -1 * m * np.cos(np.radians(ang)) for _, m, ang in zip(x, vec_mag, angles)]
    y_e = [-1 * m * np.sin(np.radians(ang)) if np.radians(ang) < 0 else m * np.sin(np.radians(ang)) for _, m, ang in zip(y, vec_mag, angles)]

    x_e_n = [m * np.sin(np.radians(ang)) if np.radians(ang) < 0 else m * np.sin(np.radians(ang)) for _, m, ang in zip(x, vec_mag_normal, angles)]
    y_e_n = [m * np.cos(np.radians(ang)) if np.radians(ang) < 0 else m * np.cos(np.radians(ang)) for _, m, ang in zip(y, vec_mag_normal, angles)]

    # Helper function to create the final vectors for all our spinal cord levels.
    def make_vectors(x, y, x_e, y_e):
      return [
        {'start': (x_0, y_0), 'vector': (x_t, y_t), 'label': l} for x_0, y_0, x_t, y_t, l in zip(x, y, x_e, y_e, level)
      ]
    
    vectors_with_starting_coordinates = make_vectors(x, y, x_e, y_e) 
    vectors_with_starting_coordinates_Normal = make_vectors(x, y, x_e_n, y_e_n)

    #=======================================
    
    # Group the above vectors based on the spinal level

    vectors_with_starting_coordinates_cervical = [v for v in vectors_with_starting_coordinates if v['label'] in cervical_levels]
    vectors_with_starting_coordinates_Normal_cervical = [v for v in vectors_with_starting_coordinates_Normal if v['label'] in cervical_levels]

    vectors_with_starting_coordinates_thoracic = [v for v in vectors_with_starting_coordinates if v['label'] in thoracic_levels]
    vectors_with_starting_coordinates_Normal_thoracic = [v for v in vectors_with_starting_coordinates_Normal if v['label'] in thoracic_levels]
    
    vectors_with_starting_coordinates_lumbar = [v for v in vectors_with_starting_coordinates if v['label'] in lumbar_levels]
    vectors_with_starting_coordinates_Normal_lumbar = [v for v in vectors_with_starting_coordinates_Normal if v['label'] in lumbar_levels]

    # Sum up all the vectors within a group to determine the overall vector for that group.
        
    resultant_vector_cervical = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_cervical], axis=0)
    resultant_vector_normal_cervical = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_Normal_cervical],
                                      axis=0)
    resultant_vector_thoracic = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_thoracic], axis=0)
    resultant_vector_normal_thoracic = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_Normal_thoracic],
                                      axis=0)
    resultant_vector_lumbar = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_lumbar], axis=0)
    resultant_vector_normal_lumbar = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_Normal_lumbar],
                                      axis=0)

    # Determine the magnitude/norm of the resultant vectors.

    sum_mag_cervical = round(np.linalg.norm(resultant_vector_cervical), 0)
    sum_mag_normal_cervical = round(np.linalg.norm(resultant_vector_normal_cervical), 0)

    sum_mag_thoracic = round(np.linalg.norm(resultant_vector_thoracic), 0)
    sum_mag_normal_thoracic = round(np.linalg.norm(resultant_vector_normal_thoracic), 0)

    sum_mag_lumbar = round(np.linalg.norm(resultant_vector_lumbar), 0)
    sum_mag_normal_lumbar = round(np.linalg.norm(resultant_vector_normal_lumbar), 0)      
    
    # Calculate the angle in radians
    angle_radians_cervical = np.arctan2(resultant_vector_cervical[1], resultant_vector_cervical[0])
    # Convert to degrees
    angle_degrees_cervical = round(np.degrees(angle_radians_cervical), 0)

    # Calculate the angle in radians
    angle_radians_thoracic = np.arctan2(resultant_vector_thoracic[1], resultant_vector_thoracic[0])
    # Convert to degrees
    angle_degrees_thoracic = round(np.degrees(angle_radians_thoracic), 0)

    # Calculate the angle in radians
    angle_radians_lumbar = np.arctan2(resultant_vector_lumbar[1], resultant_vector_lumbar[0])
    # Convert to degrees
    angle_degrees_lumbar = round(np.degrees(angle_radians_lumbar), 0)

    #=======================================

    # Extracting only the vector components and adding them

    resultant_vector = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates], axis=0)
    resultant_vector_normal = np.sum([np.array(vec['vector']) for vec in vectors_with_starting_coordinates_Normal], axis=0)

    # Calculate the angle in radians
    angle_radians = np.arctan2(resultant_vector[1], resultant_vector[0])

    # Convert to degrees
    angle_degrees = round(np.degrees(angle_radians), 0)

    # Calculating magnitude
    sum_mag = round(np.linalg.norm(resultant_vector), 0)
    sum_mag_normal = round(np.linalg.norm(resultant_vector_normal), 0)

    vec_ratio = np.tan(np.radians(angles))

    # Store all the calculated data into an array that we will then bridge back to JS.
    stored_data = [[round(float(ang),1), round(float(mag_s),1), round(float(mag_O),1), round(float(ratio), 1), level] for ang, mag_s, mag_O, ratio, level in zip(angles, vec_mag_S_non_abs, vec_mag_O_non_abs, vec_ratio, level)]
    stored_data.append([180 - angle_degrees_cervical, sum_mag_cervical, sum_mag_normal_cervical, round(np.tan(angle_radians_cervical),1), 'RSV-C'])
    stored_data.append([180 - angle_degrees_thoracic, sum_mag_thoracic, sum_mag_normal_thoracic, round(np.tan(angle_radians_thoracic), 1), 'RSV-T'])
    stored_data.append([180 - angle_degrees_lumbar, sum_mag_lumbar, sum_mag_normal_lumbar, round(np.tan(angle_radians_lumbar), 1), 'RSV-L'])
    stored_data.append([180 - angle_degrees, sum_mag, sum_mag_normal, round(np.tan(angle_radians), 1), 'GSV'])
  `);

  let storedData = pyodide.globals
    .get("stored_data")
    .toJs({ create_proxies: false });
  console.log(storedData);

  let resultantVector = pyodide.globals
    .get("resultant_vector")
    .toJs({ create_proxies: false });

  let angleDegrees = pyodide.globals.get("angle_degrees");
  let sumMag = pyodide.globals.get("sum_mag");

  return {
    storedData: storedData,
    angleDegrees: angleDegrees,
    sumMag: sumMag,
    resultantVector: resultantVector,
  };
}
