{{/* The service name: the release name unless overridden. */}}
{{- define "ms.name" -}}
{{- default .Release.Name .Values.nameOverride | trunc 52 | trimSuffix "-" -}}
{{- end -}}

{{- define "ms.tag" -}}
{{- default .Values.global.image.tag .Values.image.tag -}}
{{- end -}}

{{- define "ms.image" -}}
{{- $repository := default (include "ms.name" .) .Values.image.repository -}}
{{- printf "%s/%s:%s" .Values.global.image.registry $repository (include "ms.tag" .) -}}
{{- end -}}

{{- define "ms.port" -}}
{{- if .Values.service.port }}{{ .Values.service.port }}{{ else }}{{ .Values.containerPort }}{{ end -}}
{{- end -}}

{{/* Labels that never change between versions (selectors). */}}
{{- define "ms.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ms.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "ms.labels" -}}
{{ include "ms.selectorLabels" . }}
app.kubernetes.io/component: {{ .Values.component }}
app.kubernetes.io/part-of: {{ .Values.global.partOf }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "ms.isRollout" -}}
{{- if ne .Values.strategy.type "rollingUpdate" }}true{{ end -}}
{{- end -}}

{{/* The smoke test URL of the new version: the canary or the preview service. */}}
{{- define "ms.smokeUrl" -}}
{{- $suffix := ternary "preview" "canary" (eq .Values.strategy.type "blueGreen") -}}
{{- printf "http://%s-%s.%s.svc.cluster.local:%s%s" (include "ms.name" .) $suffix .Release.Namespace (include "ms.port" .) .Values.smokeTestPath -}}
{{- end -}}

{{/* Replicas the service always keeps (for the disruption budget). */}}
{{- define "ms.minReplicas" -}}
{{- if .Values.autoscaling.enabled }}{{ .Values.autoscaling.minReplicas }}{{ else }}{{ .Values.replicas }}{{ end -}}
{{- end -}}
