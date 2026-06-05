import type { ReviewReport } from "../../../schemas/review.js";
import type { ExternalResultEnvelope } from "./externalResultEnvelope.js";

export type ExternalReviewEnvelope = ExternalResultEnvelope & {
  payload: {
    review: ReviewReport;
  };
};
