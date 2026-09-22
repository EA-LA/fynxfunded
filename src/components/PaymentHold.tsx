import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction } from "@/components/ui/alert-dialog";

export const paymentHoldMessage = "Please wait while we finish the final step. Payments are not open yet. You can explore the platform and manage your account in the meantime. No payment has been taken.";

export default function PaymentHold({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Payments are opening soon</AlertDialogTitle><AlertDialogDescription>{paymentHoldMessage}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogAction>Continue exploring</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
