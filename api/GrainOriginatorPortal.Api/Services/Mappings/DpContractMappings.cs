using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the DP-contract domain.</summary>
public static class DpContractMappings
{
    public static DpContractResponse ToResponse(this DpContract d) => new()
    {
        Id = d.Id,
        TicketKey = d.TicketKey,
        TicketNumber = d.TicketNumber,
        ContractNumber = d.ContractNumber,
        ContractPrefixType = d.ContractPrefixType,
        ContractPrefixCommodity = d.ContractPrefixCommodity,
        ContractSuffix = d.ContractSuffix,
        TicketStatus = d.TicketStatus,
        CustomerId = d.CustomerId,
        CustomerCode = d.CustomerCode,
        TradeUnitCode = d.TradeUnitCode,
        Crop = d.Crop,
        Quantity = d.Quantity,
        GrossQuantity = d.GrossQuantity,
        QuantityUom = d.QuantityUom,
        Bushels = d.Bushels,
        StorageDays = d.StorageDays,
        DecideFreeDays = d.DecideFreeDays,
        StorageRate = d.StorageRate,
        ReceivableAmount = d.ReceivableAmount,
        PrepaidAmount = d.PrepaidAmount,
        UnearnedStorageAmount = d.UnearnedStorageAmount,
        UnpaidHandlingAmount = d.UnpaidHandlingAmount,
        // The view declares every date NOT NULL, so "no date" arrives as a floor value rather than
        // NULL — normalize it so the UI shows a blank instead of "1/1/01".
        StorageStartDate = DpBushelConversion.NullIfSentinel(d.StorageStartDate),
        ChargedFromDate = DpBushelConversion.NullIfSentinel(d.ChargedFromDate),
        ChargedThruDate = DpBushelConversion.NullIfSentinel(d.ChargedThruDate),
        PaidThruDate = DpBushelConversion.NullIfSentinel(d.PaidThruDate),
        BolDate = DpBushelConversion.NullIfSentinel(d.BolDate),
        Status = d.Status,
        StatusDescription = d.StatusDescription,
        StorageProgramCode = d.StorageProgramCode,
        StorageErrorFlag = d.StorageErrorFlag,
        StorageErrorDescription = d.StorageErrorDescription,
        LocationName = d.LocationName,
    };
}
