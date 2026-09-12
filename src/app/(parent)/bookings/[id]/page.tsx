import Link from "next/link";
import { notFound } from "next/navigation";
import { PaymentActions } from "@/components/payment-actions";
import { FlashAlert } from "@/components/flash-alert";
import { PageShell } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { formatClassDate } from "@/lib/format";
import { getSessionParent } from "@/lib/auth";
import { BookingError } from "@/lib/errors";
import {
  getBookingPageErrorMessage,
  getBookingPageNoticeMessage,
  getQueryParam,
} from "@/lib/flash-messages";
import { bookingService } from "@/lib/services";

type BookingPageProps = PageProps<"/bookings/[id]">;

export default async function BookingPage({
  params,
  searchParams,
}: BookingPageProps) {
  const parent = await getSessionParent();
  if (!parent) {
    return null;
  }

  const { id } = await params;
  const query = await searchParams;
  const pageErrorMessage = getBookingPageErrorMessage(
    getQueryParam(query.error),
  );
  const pageNoticeMessage = getBookingPageNoticeMessage(
    getQueryParam(query.notice),
  );

  let booking;
  try {
    booking = await bookingService.getBookingForParent(parent.id, id);
  } catch (error) {
    if (error instanceof BookingError && error.code === "UNAUTHORIZED") {
      notFound();
    }
    throw error;
  }

  const showPayment = booking.status === "pending_payment";

  return (
    <PageShell
      title="Booking status"
      description="Review the booking result after submission and payment."
    >
      <div className="max-w-xl space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
        {pageNoticeMessage ? (
          <FlashAlert variant="notice">{pageNoticeMessage}</FlashAlert>
        ) : null}

        {pageErrorMessage ? (
          <FlashAlert variant="error">{pageErrorMessage}</FlashAlert>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">{booking.trialClass.title}</h2>
          <StatusBadge status={booking.status} />
        </div>

        <dl className="grid gap-3 text-sm">
          <div className="flex justify-between gap-4 border-b border-border pb-3">
            <dt className="text-muted">Child</dt>
            <dd className="font-medium">{booking.student.name}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border pb-3">
            <dt className="text-muted">Class time</dt>
            <dd className="font-medium">
              {formatClassDate(booking.trialClass.scheduledAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Booking ID</dt>
            <dd className="font-mono text-xs">{booking.id}</dd>
          </div>
        </dl>

        {showPayment ? <PaymentActions bookingId={booking.id} /> : null}

        {booking.status === "confirmed" ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-success">
            This child is confirmed on the class roster.
          </p>
        ) : null}

        {booking.status === "payment_failed" ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
            Payment did not complete. The child is not on the confirmed roster.
          </p>
        ) : null}

        {booking.status === "seat_lost" ? (
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-warning">
            Your payment went through, but the last seat was taken before we
            could confirm this booking. A full refund has been issued and the
            child is not on the confirmed roster.
          </p>
        ) : null}

        <Link
          href="/"
          className="inline-flex text-sm font-medium text-brand hover:text-brand-hover"
        >
          Back to dashboard
        </Link>
      </div>
    </PageShell>
  );
}
