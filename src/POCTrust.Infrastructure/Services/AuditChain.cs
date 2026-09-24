using System.Security.Cryptography;
using System.Text;
using POCTrust.Core.Entities;
using POCTrust.Infrastructure.Data;

namespace POCTrust.Infrastructure.Services;

/// <summary>Result of walking the append-only audit hash chain.</summary>
/// <param name="Valid">True when every sealed entry commits to its predecessor correctly.</param>
/// <param name="SealedCount">Number of sealed (hashed) entries verified.</param>
/// <param name="LegacyCount">Entries written before sealing existed — unsealed prefix, not verified.</param>
/// <param name="BrokenAt">Id of the first entry whose stored hash/prev-hash did not match, if any.</param>
public sealed record AuditChainReport(bool Valid, int SealedCount, int LegacyCount, Guid? BrokenAt)
{
    public static readonly AuditChainReport Empty = new(true, 0, 0, null);
}

/// <summary>
/// Tamper-evident sealing for the append-only audit trail. Each entry is hashed with SHA-256 over
/// its full content plus the previous entry's hash, so any later edit to a sealed entry (evidence
/// JSON, statuses, action, summary, timestamp) invalidates that entry and every hash after it.
///
/// Chain order is the canonical audit order used everywhere else in the product:
/// TimestampUtc, then Id as the deterministic tie-break. Entries written before sealing was
/// introduced carry an empty hash and are treated as an unsealed legacy prefix — the chain starts
/// at the first sealed entry. Verification is intentionally strict in the safe direction: a
/// chain it cannot reproduce is reported broken, never silently accepted.
/// </summary>
public static class AuditChain
{
    public const string Genesis = "GENESIS";

    public static string ComputeHash(AuditEntry entry, string prevHash)
    {
        var payload = string.Join('|',
            entry.Id,
            entry.AssessmentId,
            entry.InputJson,
            (int)entry.InitialStatus,
            entry.AiConsulted,
            entry.AiSummary ?? "",
            (int)entry.FinalStatus,
            entry.Action,
            entry.TimestampUtc.ToUnixTimeMilliseconds(),
            prevHash);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    /// <summary>Hash the entry against the chain's current head ("GENESIS" when the trail is empty
    /// or its last entry predates sealing). The entry is not modified — the caller assigns the
    /// returned <c>PrevHash</c>/<c>Hash</c> pair before saving.</summary>
    public static (string PrevHash, string Hash) Seal(AuditEntry entry, IReadOnlyList<AuditEntry> existingOrdered)
    {
        var last = existingOrdered.Count > 0 ? existingOrdered[^1] : null;
        var prev = !string.IsNullOrEmpty(last?.Hash) ? last.Hash : Genesis;
        return (prev, ComputeHash(entry, prev));
    }

    public static AuditChainReport Verify(IEnumerable<AuditEntry> rows)
    {
        var ordered = rows.OrderBy(a => a.TimestampUtc).ThenBy(a => a.Id).ToList();
        var legacy = ordered.Count(a => string.IsNullOrEmpty(a.Hash));

        string prev = Genesis;
        var started = false;
        var sealedCount = 0;

        foreach (var entry in ordered)
        {
            if (string.IsNullOrEmpty(entry.Hash)) continue;   // unsealed legacy prefix

            var expectedPrev = started ? prev : Genesis;
            var expectedHash = ComputeHash(entry, expectedPrev);
            if (!string.Equals(entry.PrevHash, expectedPrev, StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(entry.Hash, expectedHash, StringComparison.OrdinalIgnoreCase))
                return new AuditChainReport(false, sealedCount, legacy, entry.Id);

            prev = entry.Hash;
            started = true;
            sealedCount++;
        }

        return new AuditChainReport(true, sealedCount, legacy, null);
    }
}
