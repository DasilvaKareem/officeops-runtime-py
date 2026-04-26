#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-officeops-runtime-py}"
REGION="${REGION:-us-central1}"
PROJECT_ID="${PROJECT_ID:-customspro-bd062}"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "Deploying ${SERVICE_NAME} to project ${PROJECT_ID} in ${REGION}"

gcloud builds submit --project "${PROJECT_ID}" --tag "${IMAGE}" .

DEPLOY_CMD=(
  gcloud run deploy "${SERVICE_NAME}"
  --project "${PROJECT_ID}"
  --region "${REGION}"
  --image "${IMAGE}"
  --allow-unauthenticated
  --port 8080
  --timeout 900
  --remove-secrets "GEMINI_API_KEY"
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT_ID},FIREBASE_STORAGE_BUCKET=${PROJECT_ID}.firebasestorage.app,DEFAULT_MODEL_PROVIDER=google,DEFAULT_MODEL_NAME=gemini-3-flash-preview,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true"
)

"${DEPLOY_CMD[@]}"
