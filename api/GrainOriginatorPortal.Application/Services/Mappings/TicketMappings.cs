using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the ticket domain.</summary>
public static class TicketMappings
{
    public static TicketResponse ToResponse(this Ticket t) => new()
    {
        Id = t.Id,
        ContractId = t.ContractId,
        CustomerId = t.CustomerId,
        FarmId = t.FarmId,
        SourceTicketHeaderId = t.SourceTicketHeaderId,
        SourceTicketDetailId = t.SourceTicketDetailId,
        CustomerCode = t.CustomerCode,
        ProductCode = t.ProductCode,
        TicketPrefix = t.TicketPrefix,
        TicketNumber = t.TicketNumber,
        TicketSuffix = t.TicketSuffix,
        ShipmentTicketNumber = t.ShipmentTicketNumber,
        CtrmContractNumber = t.CtrmContractNumber,
        OrganizationCode = t.OrganizationCode,
        ElevatorCode = t.ElevatorCode,
        UnloadOrganizationCode = t.UnloadOrganizationCode,
        ElevatorCity = t.ElevatorCity,
        ElevatorState = t.ElevatorState,
        Date = t.Date,
        FinalSettledDate = t.FinalSettledDate,
        ParsedDate = t.ParsedDate,
        UnloadQuantity = t.UnloadQuantity,
        LoadoutQuantity = t.LoadoutQuantity,
        AppliedDockQuantity = t.AppliedDockQuantity,
        AppliedQuantity = t.AppliedQuantity,
        GrossWeight = t.GrossWeight,
        TareWeight = t.TareWeight,
        NetWeight = t.NetWeight,
        Moisture = t.Moisture,
        TestWeight = t.TestWeight,
        ProteinPercent = t.ProteinPercent,
        GradeCode = t.GradeCode,
        TicketType = t.TicketType,
        IsApplied = t.IsApplied,
        TicketStatusDescription = t.TicketStatusDescription,
        IsActive = t.IsActive,
    };
}
