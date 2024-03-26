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

export const calcCumLevel = () => {
  let cumulativeLevelProportion = {};
  let cumulativeSingleLevelProportion = {};

  let totalHeadContribution = 7;
  let totalCervicalContribution = 4;
  let totalWeightOnLumbar = 65;
  let totalTrunkUpperExtremitiesContributions =
    totalWeightOnLumbar - totalHeadContribution - totalCervicalContribution;

  let cervicalList = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"];
  let thoracicLumbarList = [
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
    "L1",
    "L2",
    "L3",
    "L4",
    "L5",
    "S1",
  ];

  let sumCervicalRegionalContribution = 0;
  cervicalList.forEach((l) => {
    sumCervicalRegionalContribution += levelProportion[l];
  });

  cervicalList.foreach((l) => {
    cumulativeLevelProportion[l] =
      levelProportion[i] / sumCervicalRegionalContribution;
    cumulativeSingleLevelProportion[l] =
      levelProportion[i] / sumCervicalRegionalContribution;
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
    sumThoracicLumbarRegionalContribution += levelProportion[i];
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
};

export function linspace(start, stop, num, endpoint = true) {
  const div = endpoint ? num - 1 : num;
  const step = (stop - start) / div;
  return Array.from({ length: num }, (_, i) => start + step * i);
}
