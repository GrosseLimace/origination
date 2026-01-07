namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents the lifecycle status of a contract.
/// </summary>
public enum ContractStatus
{
    /// <summary>
    /// Contract is active and deliveries are expected.
    /// </summary>
    Active,

    /// <summary>
    /// All deliveries have been completed.
    /// </summary>
    Fulfilled,

    /// <summary>
    /// Contract is awaiting approval or signatures.
    /// </summary>
    Pending,

    /// <summary>
    /// Contract was cancelled before completion.
    /// </summary>
    Cancelled
}