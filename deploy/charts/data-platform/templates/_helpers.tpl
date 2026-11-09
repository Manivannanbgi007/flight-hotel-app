{{/* image: <global.imageRegistry or image.registry>/<repository>:<tag> */}}
{{- define "dp.image" -}}
{{- $registry := default .image.registry .root.Values.global.imageRegistry -}}
{{- printf "%s/%s:%s" $registry .image.repository .image.tag -}}
{{- end -}}

{{- define "dp.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/part-of: flight-hotel
app.kubernetes.io/component: data
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end -}}

{{- define "dp.selector" -}}
app.kubernetes.io/name: {{ .name }}
{{- end -}}

{{/* A password from the shared secret. */}}
{{- define "dp.secretEnv" -}}
- name: {{ .env }}
  valueFrom:
    secretKeyRef:
      name: {{ .root.Values.global.secretName }}
      key: {{ default .env .key }}
{{- end -}}

{{- define "dp.storageClass" -}}
{{- with .Values.global.storageClassName }}
storageClassName: {{ . }}
{{- end }}
{{- end -}}

{{/* Hardened container settings for images that run as a non-root user. */}}
{{- define "dp.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
{{- end -}}
