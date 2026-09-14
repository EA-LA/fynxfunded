import type { PaymentMethodType } from "./types";
import { displayDate, publicOrderReference } from "@/lib/publicReferences";

export type ReceiptOrder = {
  id?: string;
  orderId?: string;
  orderNumber?: string;
  amount?: number;
  currency?: string;
  paymentMethod?: PaymentMethodType | string;
  status?: string;
  createdAt?: unknown;
  paidAt?: unknown;
  challenge?: string;
  accountSize?: number;
  phase?: string;
  style?: string;
};

function paymentMethod(method?: string) {
  return ({ card: "Credit / debit card", paypal: "PayPal", apple: "Apple Pay", crypto: "Cryptocurrency" } as Record<string, string>)[method || ""] || "Card";
}

function currency(amount = 0, code = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code.toUpperCase() }).format(amount);
}

export async function createReceiptPdf(order: ReceiptOrder) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const receiptNumber = publicOrderReference(order);
  const total = currency(Number(order.amount || 0), order.currency || "USD");
  const paidOn = displayDate(order.paidAt || order.createdAt);
  const challenge = order.challenge || `${currency(Number(order.accountSize || 0), order.currency || "USD")} ${String(order.phase || "").replace("-", " ")} challenge`;

  pdf.setFillColor(8, 8, 9);
  pdf.rect(0, 0, 210, 297, "F");
  pdf.setDrawColor(48, 48, 52);
  pdf.roundedRect(15, 15, 180, 267, 4, 4, "S");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text("FYNX", 25, 33);
  pdf.setTextColor(155, 155, 160);
  pdf.setFont("helvetica", "normal");
  pdf.text("Funded", 51, 33);
  pdf.setFontSize(10);
  pdf.text("PAYMENT RECEIPT", 25, 48);
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(26);
  pdf.text("Thank you for your purchase.", 25, 67);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(170, 170, 175);
  pdf.setFontSize(10);
  pdf.text("Your challenge order has been confirmed and is available in your dashboard.", 25, 76);

  pdf.setFillColor(18, 18, 20);
  pdf.roundedRect(25, 90, 160, 102, 3, 3, "F");
  const rows: Array<[string, string]> = [
    ["Receipt number", receiptNumber],
    ["Date", paidOn],
    ["Challenge", challenge],
    ["Payment method", paymentMethod(order.paymentMethod)],
    ["Status", String(order.status || "paid").toUpperCase()],
  ];
  let y = 106;
  for (const [label, value] of rows) {
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(145, 145, 150);
    pdf.setFontSize(9);
    pdf.text(label, 34, y);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(250, 250, 250);
    pdf.text(pdf.splitTextToSize(value, 98), 176, y, { align: "right" });
    if (y < 170) {
      pdf.setDrawColor(45, 45, 49);
      pdf.line(34, y + 8, 176, y + 8);
    }
    y += 18;
  }

  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(25, 204, 160, 27, 3, 3, "F");
  pdf.setTextColor(15, 15, 16);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Total paid", 34, 220);
  pdf.setFontSize(17);
  pdf.text(total, 176, 220, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(125, 125, 130);
  pdf.setFontSize(8.5);
  pdf.text("This receipt confirms a simulated trading evaluation purchase.", 25, 250);
  pdf.text("FYNX Funded  •  fynxfunded.com  •  support@fynxfunded.com", 25, 258);
  pdf.text("Keep this receipt for your records.", 25, 266);
  return pdf;
}

export async function downloadReceipt(order: ReceiptOrder) {
  const pdf = await createReceiptPdf(order);
  pdf.save("FYNX Receipt.pdf");
}
