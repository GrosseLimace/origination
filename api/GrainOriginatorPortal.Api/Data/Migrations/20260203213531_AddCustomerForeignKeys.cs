using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GrainOriginatorPortal.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerForeignKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Farms");

            migrationBuilder.DropTable(
                name: "Notes");

            migrationBuilder.DropTable(
                name: "PlantingIntentions");

            migrationBuilder.DropTable(
                name: "SavedLists");

            migrationBuilder.DropTable(
                name: "StoredGrains");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Tickets",
                table: "Tickets");

            migrationBuilder.DropIndex(
                name: "IX_Tickets_FarmId",
                table: "Tickets");

            migrationBuilder.DropIndex(
                name: "IX_Tickets_TicketNumber",
                table: "Tickets");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Customers",
                table: "Customers");

            migrationBuilder.DropIndex(
                name: "IX_Customers_Location",
                table: "Customers");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Contracts",
                table: "Contracts");

            migrationBuilder.DropIndex(
                name: "IX_Contracts_ContractNumber",
                table: "Contracts");

            migrationBuilder.DropIndex(
                name: "IX_Contracts_CustomerId",
                table: "Contracts");

            migrationBuilder.DropIndex(
                name: "IX_Contracts_FarmId",
                table: "Contracts");

            migrationBuilder.DropIndex(
                name: "IX_Contracts_Status",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "Crop",
                table: "Tickets");

            migrationBuilder.DropColumn(
                name: "FarmId",
                table: "Tickets");

            migrationBuilder.DropColumn(
                name: "GrossWeight",
                table: "Tickets");

            migrationBuilder.DropColumn(
                name: "NetWeight",
                table: "Tickets");

            migrationBuilder.DropColumn(
                name: "TareWeight",
                table: "Tickets");

            migrationBuilder.DropColumn(
                name: "ESignEnabled",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "Farm",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "FarmIds",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "Location",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "TotalAcres",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "Crop",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "CustomerId",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "DeliveryEnd",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "DeliveryStart",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "FarmId",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "Price",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "Quantity",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "Signed",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Contracts");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "Contracts");

            migrationBuilder.EnsureSchema(
                name: "base");

            migrationBuilder.EnsureSchema(
                name: "dbo");

            migrationBuilder.RenameTable(
                name: "Tickets",
                newName: "Ticket",
                newSchema: "base");

            migrationBuilder.RenameTable(
                name: "Customers",
                newName: "customer",
                newSchema: "dbo");

            migrationBuilder.RenameTable(
                name: "Contracts",
                newName: "Contract",
                newSchema: "base");

            migrationBuilder.RenameColumn(
                name: "TestWeight",
                schema: "base",
                table: "Ticket",
                newName: "TestWeightPercent");

            migrationBuilder.RenameColumn(
                name: "Moisture",
                schema: "base",
                table: "Ticket",
                newName: "MoisturePercent");

            migrationBuilder.RenameColumn(
                name: "Date",
                schema: "base",
                table: "Ticket",
                newName: "TicketDate");

            migrationBuilder.RenameColumn(
                name: "Id",
                schema: "base",
                table: "Ticket",
                newName: "TicketId");

            migrationBuilder.RenameIndex(
                name: "IX_Tickets_Date",
                schema: "base",
                table: "Ticket",
                newName: "IX_Ticket_TicketDate");

            migrationBuilder.RenameIndex(
                name: "IX_Tickets_CustomerId",
                schema: "base",
                table: "Ticket",
                newName: "IX_Ticket_CustomerId");

            migrationBuilder.RenameColumn(
                name: "Name",
                schema: "dbo",
                table: "customer",
                newName: "name");

            migrationBuilder.RenameColumn(
                name: "Id",
                schema: "dbo",
                table: "customer",
                newName: "id");

            migrationBuilder.RenameIndex(
                name: "IX_Customers_Name",
                schema: "dbo",
                table: "customer",
                newName: "IX_customer_name");

            migrationBuilder.RenameColumn(
                name: "Id",
                schema: "base",
                table: "Contract",
                newName: "ContractId");

            migrationBuilder.AlterColumn<string>(
                name: "TicketNumber",
                schema: "base",
                table: "Ticket",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50);

            migrationBuilder.AlterColumn<long>(
                name: "CustomerId",
                schema: "base",
                table: "Ticket",
                type: "bigint",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50);

            migrationBuilder.AlterColumn<DateTime>(
                name: "TicketDate",
                schema: "base",
                table: "Ticket",
                type: "date",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "datetime2");

            migrationBuilder.AlterColumn<long>(
                name: "TicketId",
                schema: "base",
                table: "Ticket",
                type: "bigint",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50)
                .Annotation("SqlServer:Identity", "1, 1");

            migrationBuilder.AddColumn<decimal>(
                name: "AppliedDockQuantity",
                schema: "base",
                table: "Ticket",
                type: "decimal(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ContractId",
                schema: "base",
                table: "Ticket",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CtrmContractNumber",
                schema: "base",
                table: "Ticket",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FinalSettledDate",
                schema: "base",
                table: "Ticket",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                schema: "base",
                table: "Ticket",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<decimal>(
                name: "LoadoutQuantity",
                schema: "base",
                table: "Ticket",
                type: "decimal(18,6)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProductCode",
                schema: "base",
                table: "Ticket",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ProteinPercent",
                schema: "base",
                table: "Ticket",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "SourceTicketDetailId",
                schema: "base",
                table: "Ticket",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "SourceTicketHeaderId",
                schema: "base",
                table: "Ticket",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TicketPrefix",
                schema: "base",
                table: "Ticket",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TicketSuffix",
                schema: "base",
                table: "Ticket",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "UnloadQuantity",
                schema: "base",
                table: "Ticket",
                type: "decimal(18,6)",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "name",
                schema: "dbo",
                table: "customer",
                type: "nvarchar(max)",
                maxLength: -1,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(200)",
                oldMaxLength: 200);

            migrationBuilder.AlterColumn<long>(
                name: "id",
                schema: "dbo",
                table: "customer",
                type: "bigint",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50)
                .Annotation("SqlServer:Identity", "1, 1");

            migrationBuilder.AlterColumn<string>(
                name: "ContractNumber",
                schema: "base",
                table: "Contract",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50);

            migrationBuilder.AlterColumn<long>(
                name: "ContractId",
                schema: "base",
                table: "Contract",
                type: "bigint",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50)
                .Annotation("SqlServer:Identity", "1, 1");

            migrationBuilder.AddColumn<string>(
                name: "SourceContractId",
                schema: "base",
                table: "Contract",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_Ticket",
                schema: "base",
                table: "Ticket",
                column: "TicketId");

            migrationBuilder.AddPrimaryKey(
                name: "PK_customer",
                schema: "dbo",
                table: "customer",
                column: "id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Contract",
                schema: "base",
                table: "Contract",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_Ticket_ContractId",
                schema: "base",
                table: "Ticket",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_Ticket_TicketNumber",
                schema: "base",
                table: "Ticket",
                column: "TicketNumber");

            migrationBuilder.CreateIndex(
                name: "IX_Contract_ContractNumber",
                schema: "base",
                table: "Contract",
                column: "ContractNumber");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_Ticket",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropIndex(
                name: "IX_Ticket_ContractId",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropIndex(
                name: "IX_Ticket_TicketNumber",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropPrimaryKey(
                name: "PK_customer",
                schema: "dbo",
                table: "customer");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Contract",
                schema: "base",
                table: "Contract");

            migrationBuilder.DropIndex(
                name: "IX_Contract_ContractNumber",
                schema: "base",
                table: "Contract");

            migrationBuilder.DropColumn(
                name: "AppliedDockQuantity",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "ContractId",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "CtrmContractNumber",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "FinalSettledDate",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "IsActive",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "LoadoutQuantity",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "ProductCode",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "ProteinPercent",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "SourceTicketDetailId",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "SourceTicketHeaderId",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "TicketPrefix",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "TicketSuffix",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "UnloadQuantity",
                schema: "base",
                table: "Ticket");

            migrationBuilder.DropColumn(
                name: "SourceContractId",
                schema: "base",
                table: "Contract");

            migrationBuilder.RenameTable(
                name: "Ticket",
                schema: "base",
                newName: "Tickets");

            migrationBuilder.RenameTable(
                name: "customer",
                schema: "dbo",
                newName: "Customers");

            migrationBuilder.RenameTable(
                name: "Contract",
                schema: "base",
                newName: "Contracts");

            migrationBuilder.RenameColumn(
                name: "TicketDate",
                table: "Tickets",
                newName: "Date");

            migrationBuilder.RenameColumn(
                name: "TestWeightPercent",
                table: "Tickets",
                newName: "TestWeight");

            migrationBuilder.RenameColumn(
                name: "MoisturePercent",
                table: "Tickets",
                newName: "Moisture");

            migrationBuilder.RenameColumn(
                name: "TicketId",
                table: "Tickets",
                newName: "Id");

            migrationBuilder.RenameIndex(
                name: "IX_Ticket_TicketDate",
                table: "Tickets",
                newName: "IX_Tickets_Date");

            migrationBuilder.RenameIndex(
                name: "IX_Ticket_CustomerId",
                table: "Tickets",
                newName: "IX_Tickets_CustomerId");

            migrationBuilder.RenameColumn(
                name: "name",
                table: "Customers",
                newName: "Name");

            migrationBuilder.RenameColumn(
                name: "id",
                table: "Customers",
                newName: "Id");

            migrationBuilder.RenameIndex(
                name: "IX_customer_name",
                table: "Customers",
                newName: "IX_Customers_Name");

            migrationBuilder.RenameColumn(
                name: "ContractId",
                table: "Contracts",
                newName: "Id");

            migrationBuilder.AlterColumn<string>(
                name: "TicketNumber",
                table: "Tickets",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "CustomerId",
                table: "Tickets",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(long),
                oldType: "bigint",
                oldNullable: true);

            migrationBuilder.AlterColumn<DateTime>(
                name: "Date",
                table: "Tickets",
                type: "datetime2",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "date");

            migrationBuilder.AlterColumn<string>(
                name: "Id",
                table: "Tickets",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                oldClrType: typeof(long),
                oldType: "bigint")
                .OldAnnotation("SqlServer:Identity", "1, 1");

            migrationBuilder.AddColumn<string>(
                name: "Crop",
                table: "Tickets",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "FarmId",
                table: "Tickets",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "GrossWeight",
                table: "Tickets",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "NetWeight",
                table: "Tickets",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TareWeight",
                table: "Tickets",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AlterColumn<string>(
                name: "Name",
                table: "Customers",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(max)",
                oldMaxLength: -1);

            migrationBuilder.AlterColumn<string>(
                name: "Id",
                table: "Customers",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                oldClrType: typeof(long),
                oldType: "bigint")
                .OldAnnotation("SqlServer:Identity", "1, 1");

            migrationBuilder.AddColumn<bool>(
                name: "ESignEnabled",
                table: "Customers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "Customers",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Farm",
                table: "Customers",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "FarmIds",
                table: "Customers",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<double>(
                name: "Latitude",
                table: "Customers",
                type: "float(10)",
                precision: 10,
                scale: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Location",
                table: "Customers",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<double>(
                name: "Longitude",
                table: "Customers",
                type: "float(10)",
                precision: 10,
                scale: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "Customers",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "TotalAcres",
                table: "Customers",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AlterColumn<string>(
                name: "ContractNumber",
                table: "Contracts",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(32)",
                oldMaxLength: 32);

            migrationBuilder.AlterColumn<string>(
                name: "Id",
                table: "Contracts",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                oldClrType: typeof(long),
                oldType: "bigint")
                .OldAnnotation("SqlServer:Identity", "1, 1");

            migrationBuilder.AddColumn<string>(
                name: "Crop",
                table: "Contracts",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "CustomerId",
                table: "Contracts",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "DeliveryEnd",
                table: "Contracts",
                type: "datetime2",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "DeliveryStart",
                table: "Contracts",
                type: "datetime2",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "FarmId",
                table: "Contracts",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "Price",
                table: "Contracts",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "Quantity",
                table: "Contracts",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "Signed",
                table: "Contracts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Contracts",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "Contracts",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Tickets",
                table: "Tickets",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Customers",
                table: "Customers",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Contracts",
                table: "Contracts",
                column: "Id");

            migrationBuilder.CreateTable(
                name: "Farms",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Acres = table.Column<int>(type: "int", nullable: false),
                    BinStorageCapacity = table.Column<int>(type: "int", nullable: true),
                    Location = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Farms", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Notes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Content = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    CustomerId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    FarmId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    IsPinned = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PlantingIntentions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Acres = table.Column<int>(type: "int", nullable: false),
                    Crop = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CustomerId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    EstimatedYield = table.Column<int>(type: "int", nullable: false),
                    FarmId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    PlantingDate = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Variety = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlantingIntentions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SavedLists",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CustomerIds = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Query = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedLists", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StoredGrains",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Bin = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Crop = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CustomerId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    FarmId = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    StorageRate = table.Column<decimal>(type: "decimal(10,6)", precision: 10, scale: 6, nullable: false),
                    StorageStartDate = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoredGrains", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_FarmId",
                table: "Tickets",
                column: "FarmId");

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_TicketNumber",
                table: "Tickets",
                column: "TicketNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Customers_Location",
                table: "Customers",
                column: "Location");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_ContractNumber",
                table: "Contracts",
                column: "ContractNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_CustomerId",
                table: "Contracts",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_FarmId",
                table: "Contracts",
                column: "FarmId");

            migrationBuilder.CreateIndex(
                name: "IX_Contracts_Status",
                table: "Contracts",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Farms_Name",
                table: "Farms",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_Notes_CreatedAt",
                table: "Notes",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Notes_CustomerId",
                table: "Notes",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_Notes_IsPinned",
                table: "Notes",
                column: "IsPinned");

            migrationBuilder.CreateIndex(
                name: "IX_PlantingIntentions_CustomerId",
                table: "PlantingIntentions",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_PlantingIntentions_FarmId",
                table: "PlantingIntentions",
                column: "FarmId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedLists_Name",
                table: "SavedLists",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_StoredGrains_CustomerId",
                table: "StoredGrains",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_StoredGrains_FarmId",
                table: "StoredGrains",
                column: "FarmId");
        }
    }
}
