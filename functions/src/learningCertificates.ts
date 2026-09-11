import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const QUIZZES: Record<string, { title: string; answers: number[] }> = {
  "q-1": { title: "Forex Fundamentals", answers: [1, 2, 1, 3, 2] },
  "q-2": { title: "Institutional Trading", answers: [2, 1, 2, 1, 1] },
  "q-3": { title: "Risk Management", answers: [2, 1, 2, 1, 1] },
};
const PASS_PERCENT = 80;

function stableId(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `FYNX-LEARN-${hash.toString(36).toUpperCase().padStart(7, "0")}`;
}

export const submitLearningQuiz = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in to save learning progress.");
  const quizId = String(request.data?.quizId || "");
  const answers: number[] = Array.isArray(request.data?.answers) ? request.data.answers.map((answer: unknown) => Number(answer)) : [];
  const quiz = QUIZZES[quizId];
  if (!quiz || answers.length !== quiz.answers.length || answers.some((answer) => !Number.isInteger(answer))) {
    throw new HttpsError("invalid-argument", "Complete every quiz question before submitting.");
  }

  const score = answers.reduce((total: number, answer: number, index: number) => total + (answer === quiz.answers[index] ? 1 : 0), 0);
  const percent = Math.round(score / quiz.answers.length * 100);
  const passed = percent >= PASS_PERCENT;
  const db = admin.firestore();
  const uid = request.auth.uid;
  const progressRef = db.collection("learning_progress").doc(uid);
  await progressRef.set({
    userId: uid,
    quizzes: { [quizId]: { title: quiz.title, score, total: quiz.answers.length, percent, passed, completedAt: admin.firestore.FieldValue.serverTimestamp() } },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const progress = (await progressRef.get()).data() || {};
  const quizzes = progress.quizzes || {};
  const completedAll = Object.keys(QUIZZES).every((id) => quizzes[id]?.passed === true);
  let certificateId: string | null = null;
  if (completedAll) {
    const user = (await db.collection("users").doc(uid).get()).data() || {};
    certificateId = stableId(`learning_completion:${uid}`);
    const issuedAt = admin.firestore.FieldValue.serverTimestamp();
    const certificate = {
      certificateId,
      publicVerificationId: certificateId,
      type: "learning_completion",
      status: "issued",
      userId: uid,
      traderName: user.displayName || user.fullName || user.email || "FYNX Learner",
      accountId: "FYNX-ACADEMY",
      challengeType: "FYNX Trading Education Program",
      accountSize: 0,
      phase: "education",
      courseName: "FYNX Trading Education Program",
      learningTopics: Object.values(QUIZZES).map((item) => item.title),
      quizAverage: Math.round(Object.keys(QUIZZES).reduce((sum, id) => sum + Number(quizzes[id]?.percent || 0), 0) / Object.keys(QUIZZES).length),
      issuedAt,
      passedDate: issuedAt,
      verificationUrl: `https://www.fynxfunded.com/certificates/verify/${certificateId}`,
      generatedFrom: { source: "learning_assessment" },
      updatedAt: issuedAt,
    };
    await Promise.all([
      db.collection("certificates").doc(certificateId).set(certificate, { merge: true }),
      db.collection("public_certificates").doc(certificateId).set(certificate, { merge: true }),
    ]);
  }

  return { score, total: quiz.answers.length, percent, passed, completedAll, certificateId };
});
