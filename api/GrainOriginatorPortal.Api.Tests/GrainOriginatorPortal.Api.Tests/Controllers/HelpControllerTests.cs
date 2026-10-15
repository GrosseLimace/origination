// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// Covers the endpoint plus the hand-edited Content/help-faq.json it serves. As with What's New, the
/// content guards matter more than the endpoint test: a typo in the file surfaces as a 500 for every
/// user on the first request after a deploy, and a dangling id surfaces as a dead chip or button.
/// <para>
/// The client has a companion test (help-faq.drift.spec.ts) for the checks that need the Angular
/// source: that routes exist, that spotlight anchors exist, and that every uiLabel still appears.
/// </para>
/// </summary>
public class HelpControllerTests
{
    private static readonly string[] ActionKinds = ["route", "spotlight", "tup", "producer-tab", "help"];
    private static readonly string[] ProducerTabs = ["contracts", "tickets", "planting", "storage", "dp"];
    private static readonly string[] Trees = ["missing-producer"];

    private static HelpContentResponse Content => HelpController.HelpContent.Value;

    private static IEnumerable<HelpFaqResponse> Faqs => Content.Faqs;

    private static HashSet<string> FaqIds => Content.Faqs.Select(f => f.Id).ToHashSet();

    /// <summary>Every piece of answer text a user reads, tagged with where it came from.</summary>
    private static IEnumerable<(string Where, string Text)> AllText() =>
        Faqs.SelectMany(f =>
            new[] { (f.Id + ".question", f.Question), (f.Id + ".answer", f.Answer) }
                .Concat((f.Steps ?? []).Select((s, i) => ($"{f.Id}.steps[{i}]", s)))
                .Concat(f.Chip is null ? [] : new[] { (f.Id + ".chip", f.Chip) }));

    private static IEnumerable<(string FaqId, HelpActionResponse Action)> AllActions() =>
        Faqs.SelectMany(f => (f.Actions ?? []).Select(a => (f.Id, a))
            .Concat(f.Link is null ? [] : new[] { (f.Id, f.Link) }));

    private readonly HelpController _sut = new();

    #region Get

    [Fact]
    public void Get_ReturnsOkWithContent()
    {
        // Act
        var result = _sut.Get();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var content = Assert.IsType<HelpContentResponse>(okResult.Value);
        Assert.NotEmpty(content.Faqs);
        Assert.NotEmpty(content.Categories);
    }

    [Fact]
    public void Controller_RequiresAnAuthenticatedUser()
    {
        // The content describes internal workflows, so it must never be served anonymously.
        Assert.NotNull(typeof(HelpController).GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true).SingleOrDefault());
    }

    #endregion

    #region Embedded content guard — ids and cross-references

    [Fact]
    public void EmbeddedContent_FaqIdsAreUniqueSlugs()
    {
        // Ids appear in deep links (/help#id) and usage events, so they have to be URL-safe and stable.
        var ids = Faqs.Select(f => f.Id).ToList();

        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.All(ids, id => Assert.Matches("^[a-z0-9]+(-[a-z0-9]+)*$", id));
    }

    [Fact]
    public void EmbeddedContent_EveryFaqHasQuestionAnswerFeatureAndDate()
    {
        Assert.All(Faqs, faq =>
        {
            Assert.False(string.IsNullOrWhiteSpace(faq.Question), faq.Id);
            Assert.False(string.IsNullOrWhiteSpace(faq.Answer), faq.Id);
            Assert.False(string.IsNullOrWhiteSpace(faq.Feature), faq.Id);
            Assert.NotEqual(default, faq.LastVerified);
            Assert.True(faq.LastVerified <= DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)), $"{faq.Id}: lastVerified is in the future");
        });
    }

    [Fact]
    public void EmbeddedContent_CategoriesAreUniqueAndOnlyReferenceRealFaqs()
    {
        var categoryIds = Content.Categories.Select(c => c.Id).ToList();
        Assert.Equal(categoryIds.Count, categoryIds.Distinct().Count());

        Assert.All(Content.Categories, category =>
        {
            Assert.False(string.IsNullOrWhiteSpace(category.Name), category.Id);
            Assert.False(string.IsNullOrWhiteSpace(category.Icon), category.Id);
            Assert.NotEmpty(category.FaqIds);
            Assert.All(category.FaqIds, id => Assert.Contains(id, FaqIds));
        });
    }

    [Fact]
    public void EmbeddedContent_EveryFaqIsReachableFromTheHelpPage()
    {
        // A question in no category never shows on the Help page — it can only be found by typing.
        var categorised = Content.Categories.SelectMany(c => c.FaqIds).ToHashSet();

        Assert.All(Faqs, faq => Assert.Contains(faq.Id, categorised));
    }

    [Fact]
    public void EmbeddedContent_SuggestionsHaveAFallbackAndOnlyReferenceRealFaqs()
    {
        Assert.True(Content.Suggestions.ContainsKey("*"), "suggestions needs a \"*\" fallback for routes without their own list");

        Assert.All(Content.Suggestions, pair =>
        {
            Assert.True(pair.Key == "*" || pair.Key.StartsWith('/'), $"suggestion key '{pair.Key}' is not a route");
            Assert.NotEmpty(pair.Value);
            Assert.All(pair.Value, id => Assert.Contains(id, FaqIds));
        });
    }

    [Fact]
    public void EmbeddedContent_RelatedQuestionsExistAndAreNotSelfReferences()
    {
        Assert.All(Faqs, faq => Assert.All(faq.Related, id =>
        {
            Assert.Contains(id, FaqIds);
            Assert.NotEqual(faq.Id, id);
        }));
    }

    [Fact]
    public void EmbeddedContent_TroubleshootEntriesPointAtExactlyOneRealTarget()
    {
        var entries = Faqs.SelectMany(f => (f.Troubleshoot ?? []).Select(t => (f.Id, t)));

        Assert.All(entries, entry =>
        {
            var (faqId, t) = entry;
            Assert.False(string.IsNullOrWhiteSpace(t.Label), faqId);
            Assert.True((t.FaqId is null) != (t.Tree is null), $"{faqId}: a troubleshoot entry needs exactly one of faqId or tree");
            if (t.FaqId is not null) Assert.Contains(t.FaqId, FaqIds);
            if (t.Tree is not null) Assert.Contains(t.Tree, Trees);
        });
    }

    #endregion

    #region Embedded content guard — actions

    [Fact]
    public void EmbeddedContent_ActionsUseAKnownKindAndALabel()
    {
        Assert.All(AllActions(), entry =>
        {
            var (faqId, action) = entry;
            Assert.Contains(action.Kind, ActionKinds);
            Assert.False(string.IsNullOrWhiteSpace(action.Label), faqId);
        });
    }

    [Fact]
    public void EmbeddedContent_ActionTargetsMatchTheirKind()
    {
        Assert.All(AllActions(), entry =>
        {
            var (faqId, action) = entry;
            switch (action.Kind)
            {
                case "route":
                    // In-app routes only. A full URL here would turn help into an open redirect.
                    Assert.NotNull(action.Target);
                    Assert.StartsWith("/", action.Target);
                    Assert.DoesNotContain("//", action.Target);
                    break;
                case "spotlight":
                    Assert.False(string.IsNullOrWhiteSpace(action.Target), $"{faqId}: spotlight needs an anchor name");
                    break;
                case "producer-tab":
                    Assert.Contains(action.Target, ProducerTabs);
                    break;
                default:
                    Assert.Null(action.Target);
                    break;
            }
        });
    }

    #endregion

    #region Embedded content guard — text

    [Fact]
    public void EmbeddedContent_BoldMarkersAreBalanced()
    {
        // The client splits on "**" and alternates plain/bold, so an odd count bolds the rest of the
        // answer by mistake.
        Assert.All(AllText(), entry =>
        {
            var markers = entry.Text.Split("**").Length - 1;
            Assert.True(markers % 2 == 0, $"{entry.Where} has an unbalanced ** marker");
        });
    }

    [Fact]
    public void EmbeddedContent_TextCarriesNoMarkupOrLinks()
    {
        // Answers are bound as text, never as HTML. Markup in the file would show up literally, and a
        // link has to be an action so the client can keep it inside the app.
        Assert.All(AllText(), entry =>
        {
            Assert.DoesNotContain("<", entry.Text);
            Assert.DoesNotContain("http://", entry.Text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("https://", entry.Text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("](", entry.Text);
        });
    }

    [Fact]
    public void EmbeddedContent_KeywordsAndLabelsAreNotBlank()
    {
        Assert.All(Faqs, faq =>
        {
            Assert.All(faq.Keywords, k => Assert.False(string.IsNullOrWhiteSpace(k), faq.Id));
            Assert.All(faq.UiLabels, l => Assert.False(string.IsNullOrWhiteSpace(l), faq.Id));
            Assert.All(faq.Routes, r => Assert.StartsWith("/", r));
        });
    }

    #endregion

    #region LoadContent

    [Fact]
    public void LoadContent_ThrowsWhenTheResourceIsMissing()
    {
        // A renamed file or a dropped <EmbeddedResource> must fail loudly, not serve empty help.

        // Act
        var ex = Assert.Throws<InvalidOperationException>(
            () => HelpController.LoadContent("GrainOriginatorPortal.Api.Content.does-not-exist.json"));

        // Assert
        Assert.Contains("EmbeddedResource", ex.Message);
    }

    #endregion
}
