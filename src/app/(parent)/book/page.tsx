import Link from "next/link";
import { createBookingAction } from "@/app/(parent)/actions";
import { FlashAlert } from "@/components/flash-alert";
import { PageShell } from "@/components/page-shell";
import { formatClassDate } from "@/lib/format";
import { getSessionParent } from "@/lib/auth";
import {
  getBookFormErrorMessage,
  getQueryParam,
} from "@/lib/flash-messages";
import { bookingService } from "@/lib/services";

type BookPageProps = PageProps<"/book">;

export default async function BookPage({ searchParams }: BookPageProps) {
  const parent = await getSessionParent();
  if (!parent) {
    return null;
  }

  const params = await searchParams;
  const formErrorMessage = getBookFormErrorMessage(
    getQueryParam(params.error),
  );

  const trialClasses = await bookingService.listTrialClasses();

  return (
    <PageShell
      title="Book a trial class"
      description="Choose one of your children and an available trial class."
    >
      {formErrorMessage ? (
        <FlashAlert variant="error">{formErrorMessage}</FlashAlert>
      ) : null}

      <form
        action={createBookingAction}
        className="max-w-xl space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm"
      >
        <div className="space-y-2">
          <label htmlFor="studentId" className="text-sm font-medium">
            Child
          </label>
          <select
            id="studentId"
            name="studentId"
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="">Select a child</option>
            {parent.students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="trialClassId" className="text-sm font-medium">
            Trial class
          </label>
          <select
            id="trialClassId"
            name="trialClassId"
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="">Select a class</option>
            {trialClasses.map((trialClass) => (
              <option
                key={trialClass.id}
                value={trialClass.id}
                disabled={trialClass.seatsAvailable === 0}
              >
                {trialClass.title} — {formatClassDate(trialClass.scheduledAt)} (
                {trialClass.seatsAvailable} seats left)
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            Continue to payment
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-background"
          >
            Cancel
          </Link>
        </div>
      </form>
    </PageShell>
  );
}
