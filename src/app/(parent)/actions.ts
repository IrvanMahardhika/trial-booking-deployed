"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireSessionParent } from "@/lib/auth";
import { BookingError } from "@/lib/errors";
import { createBookingSchema } from "@/lib/schemas";
import { bookingService } from "@/lib/services";

function redirectCreateBookingError(code: BookingError["code"]) {
  switch (code) {
    case "DUPLICATE_BOOKING":
      redirect("/book?error=duplicate_booking");
    case "CLASS_FULL":
      redirect("/book?error=class_full");
    case "NOT_FOUND":
      redirect("/book?error=not_found");
    case "UNAUTHORIZED":
      redirect("/book?error=unauthorized");
    default:
      redirect("/book?error=unknown");
  }
}

export async function createBookingAction(formData: FormData) {
  const parent = await requireSessionParent();

  let studentId: string;
  let trialClassId: string;

  try {
    ({ studentId, trialClassId } = createBookingSchema.parse({
      studentId: formData.get("studentId"),
      trialClassId: formData.get("trialClassId"),
    }));
  } catch (error) {
    if (error instanceof ZodError) {
      redirect("/book?error=invalid");
    }
    throw error;
  }

  try {
    const booking = await bookingService.createBookingForParent(
      parent.id,
      studentId,
      trialClassId,
    );

    redirect(`/bookings/${booking.id}`);
  } catch (error) {
    if (error instanceof BookingError) {
      if (error.code === "DUPLICATE_BOOKING") {
        const existing = await bookingService.getActiveBooking(
          studentId,
          trialClassId,
        );

        if (existing) {
          redirect(`/bookings/${existing.id}?notice=duplicate`);
        }
      }

      redirectCreateBookingError(error.code);
    }

    throw error;
  }
}

export async function submitPaymentAction(
  bookingId: string,
  shouldSucceed: boolean,
) {
  const parent = await requireSessionParent();

  try {
    await bookingService.getBookingForParent(parent.id, bookingId);
    await bookingService.submitPayment(bookingId, shouldSucceed);
  } catch (error) {
    if (error instanceof BookingError) {
      redirect(`/bookings/${bookingId}?error=${error.code.toLowerCase()}`);
    }
    throw error;
  }

  redirect(`/bookings/${bookingId}`);
}

export async function paySuccessfullyAction(bookingId: string) {
  await submitPaymentAction(bookingId, true);
}

export async function payWithFailureAction(bookingId: string) {
  await submitPaymentAction(bookingId, false);
}
