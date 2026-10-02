namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Serialises the database integration tests.
///
/// They all run against one shared database and each wraps itself in a transaction it rolls back. Run
/// in parallel — which is xUnit's default for separate classes — those transactions contend on the
/// same bid-sheet rows and tests fail on lock timeouts rather than on anything they assert. The
/// symptom is nasty to diagnose: each class passes alone and fails in the suite.
///
/// Membership of one collection makes xUnit run them one after another.
/// </summary>
[CollectionDefinition("Database")]
public class DatabaseCollection;
