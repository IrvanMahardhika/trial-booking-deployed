import { BookingStatus, type Booking, type PrismaClient } from "@/generated/prisma";
import { BookingError } from "@/lib/errors";
import { mockPayment, refundPayment, type PaymentResult } from "@/lib/payment";
import { verifyPassword } from "@/lib/password";

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.pending_payment,
  BookingStatus.confirmed,
];

export type BookingWithRelations = Booking & {
  student: { id: string; name: string };
  trialClass: { id: string; title: string; capacity: number; scheduledAt: Date };
};

export class BookingService {
  constructor(private readonly db: PrismaClient) {}

  async listTrialClasses() {
    const classes = await this.db.trialClass.findMany({
      orderBy: { scheduledAt: "asc" },
      include: {
        bookings: {
          where: { status: BookingStatus.confirmed },
          select: { id: true },
        },
      },
    });

    return classes.map((trialClass) => ({
      id: trialClass.id,
      title: trialClass.title,
      scheduledAt: trialClass.scheduledAt,
      capacity: trialClass.capacity,
      confirmedCount: trialClass.bookings.length,
      seatsAvailable: trialClass.capacity - trialClass.bookings.length,
    }));
  }

  async listStudents(parentId: string) {
    return this.db.student.findMany({
      where: { parentId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  async authenticateParent(email: string, password: string) {
    const parent = await this.db.parent.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, password: true },
    });

    if (!parent) {
      throw new BookingError("Invalid email or password", "UNAUTHORIZED");
    }

    const passwordMatches = await verifyPassword(password, parent.password);

    if (!passwordMatches) {
      throw new BookingError("Invalid email or password", "UNAUTHORIZED");
    }

    return {
      id: parent.id,
      name: parent.name,
      email: parent.email,
    };
  }

  async listParents() {
    return this.db.parent.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    });
  }

  async getParentProfile(parentId: string) {
    const parent = await this.db.parent.findUnique({
      where: { id: parentId },
      include: {
        students: {
          orderBy: { name: "asc" },
          include: {
            bookings: {
              include: {
                trialClass: {
                  select: { id: true, title: true, scheduledAt: true, capacity: true },
                },
              },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!parent) {
      throw new BookingError("Parent not found", "NOT_FOUND");
    }

    return parent;
  }

  async createBookingForParent(
    parentId: string,
    studentId: string,
    trialClassId: string,
  ) {
    const student = await this.db.student.findFirst({
      where: { id: studentId, parentId },
    });

    if (!student) {
      throw new BookingError(
        "Student not found for this parent account",
        "UNAUTHORIZED",
      );
    }

    return this.createBooking(studentId, trialClassId);
  }

  async getBooking(bookingId: string): Promise<BookingWithRelations> {
    const booking = await this.db.booking.findUnique({
      where: { id: bookingId },
      include: {
        student: { select: { id: true, name: true } },
        trialClass: { select: { id: true, title: true, capacity: true, scheduledAt: true } },
      },
    });

    if (!booking) {
      throw new BookingError("Booking not found", "NOT_FOUND");
    }

    return booking;
  }

  async getBookingForParent(parentId: string, bookingId: string) {
    const booking = await this.getBooking(bookingId);
    const student = await this.db.student.findFirst({
      where: { id: booking.studentId, parentId },
    });

    if (!student) {
      throw new BookingError("Booking not found for this account", "UNAUTHORIZED");
    }

    return booking;
  }

  async getClassRoster(trialClassId: string) {
    const trialClass = await this.db.trialClass.findUnique({
      where: { id: trialClassId },
      include: {
        bookings: {
          where: { status: BookingStatus.confirmed },
          include: {
            student: {
              include: { parent: { select: { id: true, name: true, email: true } } },
            },
          },
          orderBy: { updatedAt: "asc" },
        },
      },
    });

    if (!trialClass) {
      throw new BookingError("Trial class not found", "NOT_FOUND");
    }

    return {
      trialClass: {
        id: trialClass.id,
        title: trialClass.title,
        scheduledAt: trialClass.scheduledAt,
        capacity: trialClass.capacity,
      },
      confirmedStudents: trialClass.bookings.map((booking) => ({
        bookingId: booking.id,
        studentId: booking.student.id,
        studentName: booking.student.name,
        parentName: booking.student.parent.name,
        parentEmail: booking.student.parent.email,
        confirmedAt: booking.updatedAt,
      })),
    };
  }

  async getActiveBooking(studentId: string, trialClassId: string) {
    return this.db.booking.findFirst({
      where: {
        studentId,
        trialClassId,
        status: { in: ACTIVE_STATUSES },
      },
      select: { id: true },
    });
  }

  async createBooking(studentId: string, trialClassId: string) {
    const trialClass = await this.db.trialClass.findUnique({
      where: { id: trialClassId },
    });

    if (!trialClass) {
      throw new BookingError("Trial class not found", "NOT_FOUND");
    }

    const student = await this.db.student.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new BookingError("Student not found", "NOT_FOUND");
    }

    const existingBooking = await this.db.booking.findFirst({
      where: {
        studentId,
        trialClassId,
        status: { in: ACTIVE_STATUSES },
      },
    });

    if (existingBooking) {
      throw new BookingError(
        "This student already has an active booking for this class",
        "DUPLICATE_BOOKING",
      );
    }

    const confirmedCount = await this.db.booking.count({
      where: {
        trialClassId,
        status: BookingStatus.confirmed,
      },
    });

    if (confirmedCount >= trialClass.capacity) {
      throw new BookingError("This class is already full", "CLASS_FULL");
    }

    const booking = await this.db.booking.create({
      data: {
        studentId,
        trialClassId,
        status: BookingStatus.pending_payment,
      },
      include: {
        student: { select: { id: true, name: true } },
        trialClass: { select: { id: true, title: true, capacity: true, scheduledAt: true } },
      },
    });

    return booking;
  }

  async completePayment(bookingId: string, paymentResult: PaymentResult) {
    return this.db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          student: { select: { id: true, name: true } },
          trialClass: { select: { id: true, title: true, capacity: true, scheduledAt: true } },
        },
      });

      if (!booking) {
        throw new BookingError("Booking not found", "NOT_FOUND");
      }

      if (booking.status !== BookingStatus.pending_payment) {
        throw new BookingError(
          `Booking is already ${booking.status}`,
          "INVALID_STATUS",
        );
      }

      await tx.paymentAttempt.create({
        data: {
          bookingId,
          success: paymentResult.success,
          message: paymentResult.message,
        },
      });

      if (!paymentResult.success) {
        const failedBooking = await tx.booking.update({
          where: { id: bookingId },
          data: { status: BookingStatus.payment_failed },
          include: {
            student: { select: { id: true, name: true } },
            trialClass: { select: { id: true, title: true, capacity: true, scheduledAt: true } },
          },
        });

        return failedBooking;
      }

      const confirmedCount = await tx.booking.count({
        where: {
          trialClassId: booking.trialClassId,
          status: BookingStatus.confirmed,
        },
      });

      if (confirmedCount >= booking.trialClass.capacity) {
        const seatLostBooking = await tx.booking.update({
          where: { id: bookingId },
          data: { status: BookingStatus.seat_lost },
          include: {
            student: { select: { id: true, name: true } },
            trialClass: { select: { id: true, title: true, capacity: true, scheduledAt: true } },
          },
        });

        await refundPayment({
          bookingId,
          reason: "Class was full before this booking could be confirmed",
        });

        return seatLostBooking;
      }

      const confirmedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.confirmed },
        include: {
          student: { select: { id: true, name: true } },
          trialClass: { select: { id: true, title: true, capacity: true, scheduledAt: true } },
        },
      });

      return confirmedBooking;
    });
  }

  async submitPayment(bookingId: string, shouldSucceed: boolean) {
    const paymentResult = mockPayment(shouldSucceed);
    return this.completePayment(bookingId, paymentResult);
  }
}
