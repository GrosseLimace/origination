// System namespaces
using System.Reflection;
using System.Text;

namespace GrainOriginatorPortal.Infrastructure.Platform.Access;

/// <summary>
/// The permission catalog: every permission the application checks, in the company permissions
/// model's <c>resource:action[:scope]</c> format (style-guides/permissions-model.md §4).
/// </summary>
/// <remarks>
/// <para><b>Three actions.</b> <c>read</c> to see a resource. <c>write</c> to create, change and delete it:
/// whoever may change a resource may also add and remove it, so one permission covers all three. This
/// is a custom action, which the style guide allows when its standard set doesn't fit (§4.2).
/// <c>manage</c> is for IT's operational powers, never business data. The only other write is
/// <c>bid-sheet-locations:delete:global</c>, a manager's power over other people's locations.</para>
/// <para><b>The nested class a permission sits in is the module that owns it,</b> and each resource
/// belongs to exactly one module. <c>AppPermissionsTests</c> enforce that and the format.</para>
/// <para><b>Why this lives in Infrastructure, not Api:</b> <c>dbo.Permission</c> is generated from this
/// catalog through EF <c>HasData</c>, and the DbContext can't reference Api. Api reads it from here.</para>
/// <para><b>Deny by default.</b> Adding a constant grants it to nobody. The same PR adds a grant
/// migration for the roles meant to hold it. Which endpoint each permission guards is listed in the
/// plan's permission catalog (agents-docs/plans/plan-modular-architecture.md §4.3).</para>
/// </remarks>
public static class AppPermissions
{
    /// <summary>Preferences, reference data, diagnostics and the grant editor.</summary>
    public static class Platform
    {
        /// <summary>Your own preferences and trade-unit assignments.</summary>
        public const string PreferencesReadOwn = "preferences:read:own";

        /// <summary>Save your own preferences, including your bid sheet preferences.</summary>
        public const string PreferencesWriteOwn = "preferences:write:own";

        /// <summary>Commodities, conversions, harvest windows, trade units, the entitlements catalog and geocode lookups.</summary>
        public const string ReferenceDataRead = "reference-data:read";

        public const string DiagnosticsRead = "diagnostics:read";

        /// <summary>Diagnostics actions that change state: the usage rollup backfill, the commodity seed and the elevator cache.</summary>
        public const string DiagnosticsManage = "diagnostics:manage";

        /// <summary>The grant editor: which permissions and segments each role holds.</summary>
        public const string RolesManage = "roles:manage";
    }

    /// <summary>The customer master, its trade-unit assignments and the customer sync.</summary>
    public static class Customers
    {
        public const string CustomersRead = "customers:read";

        /// <summary>Assign or remove a customer's trade units, which is also how a producer is onboarded.</summary>
        public const string CustomersWrite = "customers:write";

        /// <summary>The customer sync's diagnostics and manual run.</summary>
        public const string CustomerSyncManage = "customer-sync:manage";
    }

    /// <summary>Contracts, pricing lines and tickets.</summary>
    public static class Contracts
    {
        public const string ContractsRead = "contracts:read";
        public const string TicketsRead = "tickets:read";
    }

    /// <summary>Notes, reminders, Teams channels and daily recap groups.</summary>
    public static class Engagement
    {
        public const string NotesRead = "notes:read";

        /// <summary>
        /// Write, edit, pin or delete any note, and register a Teams channel picked in the note composer.
        /// Notes are shared: anyone may edit one, not only its author.
        /// </summary>
        public const string NotesWrite = "notes:write";

        /// <summary>Reminders belong to their owner: every reminder endpoint reads and writes only the caller's own.</summary>
        public const string RemindersReadOwn = "reminders:read:own";

        /// <summary>Create, edit, complete, delete or add to Outlook one of your own reminders.</summary>
        public const string RemindersWriteOwn = "reminders:write:own";

        public const string TeamsChannelsRead = "teams-channels:read";
        public const string RecapGroupsRead = "recap-groups:read";

        /// <summary>Create, edit or enable a recap group you can see. Only a group's creator may delete it, as the service checks today.</summary>
        public const string RecapGroupsWrite = "recap-groups:write";
    }

    /// <summary>Planting, producer details, stored grain, DP contracts, pacing, estimates and the field plan.</summary>
    public static class Producers
    {
        public const string PlantingIntentionsRead = "planting-intentions:read";

        /// <summary>Includes moving a producer's intentions to another trade unit.</summary>
        public const string PlantingIntentionsWrite = "planting-intentions:write";

        public const string ProducerDetailsRead = "producer-details:read";
        public const string ProducerDetailsWrite = "producer-details:write";
        public const string StoredGrainRead = "stored-grain:read";
        public const string DpContractsRead = "dp-contracts:read";
        public const string ContractPacingRead = "contract-pacing:read";

        /// <summary>The Planting Dashboard's estimates, market shares and actual harvest.</summary>
        public const string PlantingEstimatesRead = "planting-estimates:read";

        public const string PlantingEstimatesWrite = "planting-estimates:write";

        /// <summary>The field plan, its CTRM splits and the tillage (T-DISC) options.</summary>
        public const string FieldPlansRead = "field-plans:read";

        /// <summary>Fields, seasons and records, including confirming or reopening a record.</summary>
        public const string FieldPlansWrite = "field-plans:write";

        /// <summary>The FD-CIC calculator, including its scoring POST, which stores nothing.</summary>
        public const string CarbonIntensityRead = "carbon-intensity:read";
    }

    /// <summary>Saved lists and the query library.</summary>
    public static class Lists
    {
        public const string SavedListsReadOwn = "saved-lists:read:own";

        /// <summary>Create, edit or delete your own saved lists.</summary>
        public const string SavedListsWriteOwn = "saved-lists:write:own";

        /// <summary>See your team's saved lists and team members.</summary>
        public const string SavedListsReadTeam = "saved-lists:read:team";

        /// <summary>Edit or delete a teammate's list whose trade units overlap yours, and send lists to teammates.</summary>
        public const string SavedListsWriteTeam = "saved-lists:write:team";

        /// <summary>The query library, including its search log, which records only telemetry.</summary>
        public const string QueryLibraryRead = "query-library:read";
    }

    /// <summary>The bid sheet and the BarChart bid feed.</summary>
    public static class BidSheet
    {
        public const string BidSheetsRead = "bid-sheets:read";

        /// <summary>
        /// Sheets, locations and bids: create, rename, share and lay out sheets; add, edit and delete
        /// locations and their bids, including refreshing bids from the feed. Deleting a location is
        /// limited to its creator unless you also hold <see cref="BidSheetLocationsDeleteGlobal"/>.
        /// </summary>
        public const string BidSheetsWrite = "bid-sheets:write";

        /// <summary>Delete a location someone else created.</summary>
        public const string BidSheetLocationsDeleteGlobal = "bid-sheet-locations:delete:global";

        /// <summary>The BarChart picker: feed locations and coverage.</summary>
        public const string BidFeedRead = "bid-feed:read";

        /// <summary>Run the BarChart ingestion: the pipeline, through its machine role, or a person by hand.</summary>
        public const string BidFeedManage = "bid-feed:manage";
    }

    /// <summary>The usage dashboard.</summary>
    public static class UsageAnalytics
    {
        public const string UsageReportsRead = "usage-reports:read";

        /// <summary>Who is excluded from the usage reports.</summary>
        public const string UsageExclusionsManage = "usage-exclusions:manage";
    }

    private static readonly IReadOnlyDictionary<string, string> Catalog = BuildCatalog();

    /// <summary>Every permission in the catalog, sorted ordinally so generated output is stable.</summary>
    public static IReadOnlyList<string> All { get; } = Catalog.Keys.Order(StringComparer.Ordinal).ToArray();

    /// <summary>
    /// The module that owns each permission, as a kebab-case id such as <c>bid-sheet</c>. These are the
    /// ids <c>/api/me/permissions</c> returns in <c>modules</c> and the client's module manifests use.
    /// </summary>
    public static IReadOnlyDictionary<string, string> ModuleOf => Catalog;

    private static Dictionary<string, string> BuildCatalog()
    {
        var catalog = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var module in typeof(AppPermissions).GetNestedTypes(BindingFlags.Public))
        {
            var moduleId = ToKebabCase(module.Name);
            foreach (var field in module.GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                if (field is not { IsLiteral: true, IsInitOnly: false } || field.FieldType != typeof(string))
                {
                    continue;
                }

                var permission = (string)field.GetRawConstantValue()!;
                if (!catalog.TryAdd(permission, moduleId))
                {
                    throw new InvalidOperationException(
                        $"Permission '{permission}' is declared twice in AppPermissions ({catalog[permission]} and {moduleId}).");
                }
            }
        }

        return catalog;
    }

    private static string ToKebabCase(string name)
    {
        var builder = new StringBuilder(name.Length + 4);
        for (var i = 0; i < name.Length; i++)
        {
            if (char.IsUpper(name[i]) && i > 0)
            {
                builder.Append('-');
            }

            builder.Append(char.ToLowerInvariant(name[i]));
        }

        return builder.ToString();
    }
}
