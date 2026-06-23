using System.ComponentModel.DataAnnotations.Schema;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Represents grain stored at a facility on behalf of a customer.
/// Source: ctrm.vw_GNTA39D1 joined with originations.vw_CurrentCustomers for numeric CustomerId.
/// </summary>
public class StoredGrain
{
    public string Id { get; set; } = string.Empty;          // Composite: WHR_RECEIPT_NUMBER|LOCATION_CODE
    public string ReceiptNumber { get; set; } = string.Empty; // WHR_RECEIPT_NUMBER — group key
    public long CustomerId { get; set; }
    public string CustomerCode { get; set; } = string.Empty; // CTRM CUSTOMER_ID
    public string Crop { get; set; } = string.Empty;
    public decimal Quantity { get; set; }       // NET_QUANTITY
    public decimal GrossQuantity { get; set; }  // GROSS_QUANTITY
    public DateTime StorageStartDate { get; set; }
    public decimal StorageRate { get; set; }
    public string Bin { get; set; } = string.Empty;
    public decimal ReceivableAmount { get; set; }   // RECEIVABLE_AMOUNT — accumulated cost from CTRM
    public decimal StorageDays { get; set; }         // STORAGE_DAYS — days in storage from CTRM
    public DateTime? ChargedFromDate { get; set; }   // CHARGED_FROM_DATE
    public DateTime? ChargedThruDate { get; set; }   // CHARGED_THRU_DATE

    [NotMapped]
    public decimal Bushels => Quantity;

    [NotMapped]
    public DateTime DateReceived => StorageStartDate;
}
