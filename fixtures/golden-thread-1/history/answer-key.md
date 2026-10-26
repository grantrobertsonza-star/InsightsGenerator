# Frozen independent answer key

Generated before application setup using NumPy/SciPy and synthetic rows, without application analytics.

{
  "n": 200,
  "unweighted": true,
  "ids": "0001..0200",
  "sheet": "Data; Notes is decoy",
  "purchase": {
    "total_pct": 50,
    "male_pct": 60,
    "female_pct": 40,
    "base_each": 100
  },
  "satisfaction": {
    "mean": 3.5,
    "male_mean": 4,
    "female_mean": 3,
    "top2_pct": 50
  },
  "nps": {
    "promoters": 90,
    "detractors": 40,
    "passives": 70,
    "total": 25,
    "male": 50,
    "female": 0
  },
  "MR": {
    "Convenience": 60,
    "Value": 45,
    "Service": 20,
    "base": 200,
    "male_convenience": 70,
    "female_convenience": 50
  },
  "significance": {
    "test": "two-sided pooled two-proportion z, independent respondents, no weights, alpha .05, no multiplicity adjustment",
    "purchase_z": 2.8284271247461894,
    "purchase_p": 0.004677734981047275,
    "expected": "male > female significant; NearTie 51% vs49% not significant"
  },
  "tolerance": "percent/NPS ?0.1 percentage point; means ?0.01; exact bases",
  "claims": {
    "C1": "correct purchase total50%",
    "C2": "correct satisfaction mean3.5",
    "C3": "correct NPS25",
    "C4": "correct convenience60%",
    "C5": "correct men purchase60%, women40%",
    "C6": "wrong purchase70%, true50%",
    "C7": "wrong satisfaction4.2, true3.5",
    "C8": "wrong NearTie51vs49 statistically significant",
    "C9": "unsupported population conclusion from small group n16 (8 per gender)",
    "C10": "unsupported claim advertising caused loyalty growth"
  },
  "omitted_effect": "Convenience70% male vs50% female (same z and p as purchase); not mentioned in report",
  "AI_acceptance": "semantic claims and source/value/base/uncertainty agreement; no exact prose requirement; repeated same-source claims are not independent corroboration"
}
