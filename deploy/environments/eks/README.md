# EKS environment (next phase)

This folder becomes the AWS environment once the kind deployment has been hand-tested (KUBERNETES_DEPLOYMENT.md,
section 13). The charts, the rollout strategies and the Argo CD layout stay the same; only the values change.

Today it holds `values.yaml` (image registry and tag; CD's `promote-eks` job writes the tag here). CI renders every
environment folder, so files added here are checked from the first pull request on.

## What the EKS phase adds

| Area | kind (today) | EKS |
|------|--------------|-----|
| Cluster | 3 control planes + 3 workers in Docker | EKS control plane (managed, multi-AZ) + a managed node group in 3 AZs (Terraform or eksctl, in `infra/`) |
| Edge | Traefik NodePort on localhost | Traefik `service.type: LoadBalancer` (AWS Load Balancer Controller, NLB), TLS with ACM or cert-manager, Route 53 |
| Images | `localhost:5001/flighthotel` | `ghcr.io/<owner>/flighthotel` or ECR (`<account>.dkr.ecr.<region>.amazonaws.com/flighthotel`) |
| MySQL | StatefulSet (`data-platform` chart) | Amazon RDS for MySQL 8.4, Multi-AZ, automated backups |
| Kafka + Connect | KRaft StatefulSet, Debezium in a Deployment | Amazon MSK; Debezium on MSK Connect or the `data-platform` chart with only Connect and Schema Registry |
| Redis | Deployment | Amazon ElastiCache (Redis OSS / Valkey) |
| Elasticsearch | StatefulSet | Amazon OpenSearch Service (the search-service client speaks the Elasticsearch API) |
| Mail | Mailpit | Amazon SES (SMTP on port 587, already allowed by the network policies) |
| Files (documents, photos, audit log exports) | PVCs (`persistence`) | S3 bucket; pods get access through EKS Pod Identity (`serviceAccountAnnotations` / association), no keys. reporting-service still needs a large `/tmp` (`tmpSizeLimit`, 3Gi or more) to write an export before it uploads it; an S3 lifecycle rule on its `exports/` prefix (1 day) is a safety net for the 24 h clean-up |
| Secrets | `create-secrets.ps1` from `.env` | AWS Secrets Manager + External Secrets Operator, which creates the same `flight-hotel-secrets` Secret |
| Replicas | 1 per backend (2 for the edge) | 2-6 per service with HPA, PDBs and zone spreading (the chart already supports all of it) |
| Demo data | `DEV_SEED_ENABLED`, `DEMO_USERS_ENABLED` on | off |

## Files to add in the EKS phase

```text
deploy/environments/eks/
  values.yaml                 (exists) registry, tag, storage class
  shared.yaml                 commonEnv with the RDS / MSK / ElastiCache / OpenSearch endpoints
  services/<service>.yaml     12 files: production replicas, HPA, no demo settings, real hostnames, S3 storage
deploy/argocd/eks/
  root.yaml, apps/            the kind layout without data-platform (managed services instead)
deploy/platform/values/       traefik-eks.yaml (NLB), argo-cd HA block (already in argo-cd.yaml, commented)
```
