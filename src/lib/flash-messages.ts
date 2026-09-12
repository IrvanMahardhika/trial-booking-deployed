export function getQueryParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function getBookFormErrorMessage(error: string | undefined) {
  switch (error) {
    case "invalid":
      return "Please select a child and a trial class before continuing.";
    case "duplicate_booking":
      return "This student already has an active booking for the selected class.";
    case "class_full":
      return "This class is already full. Please choose another class.";
    case "not_found":
      return "The selected child or class could not be found.";
    case "unauthorized":
      return "You are not allowed to book for this student.";
    default:
      return null;
  }
}

export function getBookingPageErrorMessage(error: string | undefined) {
  switch (error) {
    case "invalid_status":
      return "This booking can no longer be paid. It may already have been processed.";
    case "not_found":
      return "This booking could not be found.";
    case "unauthorized":
      return "You do not have access to this booking.";
    default:
      return null;
  }
}

export function getBookingPageNoticeMessage(notice: string | undefined) {
  switch (notice) {
    case "duplicate":
      return "This student already has an active booking for this class. You can continue payment or review the status below.";
    default:
      return null;
  }
}
