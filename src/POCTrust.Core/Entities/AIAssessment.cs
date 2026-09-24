namespace POCTrust.Core.Entities;

public sealed record AIAssessment(
    string Summary,
    IReadOnlyList<string> Anomalies,
    string RecommendedAction,
    double Confidence,
    string Model
);
