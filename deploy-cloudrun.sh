#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-officeops-runtime-py}"
REGION="${REGION:-us-central1}"
PROJECT_ID="${PROJECT_ID:-customspro-bd062}"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "Deploying ${SERVICE_NAME} to project ${PROJECT_ID} in ${REGION}"

gcloud builds submit --project "${PROJECT_ID}" --tag "${IMAGE}" .

SECRET_FLAG=()
if gcloud secrets describe GEMINI_API_KEY --project "${PROJECT_ID}" >/dev/null 2>&1; then
  SECRET_FLAG=(--update-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest")
  echo "Using GEMINI_API_KEY from Secret Manager"
else
  echo "GEMINI_API_KEY secret not found. Deploying without Gemini secret for now."
fi

DEPLOY_CMD=(
  gcloud run deploy "${SERVICE_NAME}"
  --project "${PROJECT_ID}"
  --region "${REGION}"
  --image "${IMAGE}"
  --allow-unauthenticated
  --port 8080
  --timeout 900
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT_ID},FIREBASE_STORAGE_BUCKET=${PROJECT_ID}.firebasestorage.app,DEFAULT_MODEL_PROVIDER=google,DEFAULT_MODEL_NAME=gemini-2.5-pro"
)

if [ "${#SECRET_FLAG[@]}" -gt 0 ]; then
  DEPLOY_CMD+=("${SECRET_FLAG[@]}")
fi

"${DEPLOY_CMD[@]}"
