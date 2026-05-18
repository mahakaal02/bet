{{/*
Service hostname helper — returns `kalki-<svc>.cloud.podstack.ai`.
Usage: {{ include "kalki.host" (dict "svc" "backend" "ctx" .) }}
*/}}
{{- define "kalki.host" -}}
{{- $ctx := .ctx -}}
{{- printf "%s%s.%s" $ctx.Values.global.hostnamePrefix .svc $ctx.Values.global.domain -}}
{{- end -}}

{{/*
Image reference — image: kalki-backend → docker.io/saurav7055/kalki-backend:tag
Per-service `tag` overrides `global.imageTag` so Flux ImageUpdateAutomation
can bump each service independently.
Usage: {{ include "kalki.image" (dict "image" .Values.backend.image "tag" .Values.backend.imageTag "ctx" .) }}
*/}}
{{- define "kalki.image" -}}
{{- $ctx := .ctx -}}
{{- $tag := default $ctx.Values.global.imageTag .tag -}}
{{- printf "%s/%s:%s" $ctx.Values.global.imageRegistry .image $tag -}}
{{- end -}}

{{/*
Standard labels applied to every workload.
*/}}
{{- define "kalki.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/part-of: kalki
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
{{- end -}}

{{/*
Pod-spec fragment: anti-affinity excluding the L40s nodes from
.Values.excludeNodes plus a hostname-spread preferred rule.
*/}}
{{- define "kalki.nodeAffinity" -}}
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: NotIn
              values:
{{- range .Values.excludeNodes }}
                - {{ . | quote }}
{{- end }}
{{- end -}}

{{/*
Service hostname env block shared across apps so cross-links resolve to the
public Traefik-fronted URLs (HTTPS).
*/}}
{{- define "kalki.publicUrlEnv" -}}
- name: NEXT_PUBLIC_BACKEND_URL
  value: "https://{{ include "kalki.host" (dict "svc" "backend" "ctx" .) }}"
- name: NEXT_PUBLIC_AUCTIONS_URL
  value: "https://{{ include "kalki.host" (dict "svc" "auctions" "ctx" .) }}"
- name: NEXT_PUBLIC_AVIATOR_URL
  value: "https://{{ include "kalki.host" (dict "svc" "aviator" "ctx" .) }}"
- name: NEXT_PUBLIC_EXCHANGE_URL
  value: "https://{{ include "kalki.host" (dict "svc" "bet" "ctx" .) }}"
- name: NEXT_PUBLIC_API_URL
  value: "https://{{ include "kalki.host" (dict "svc" "backend" "ctx" .) }}"
- name: AUCTIONS_BACKEND_URL
  value: "http://kalki-backend:4000"
- name: BET_BASE_URL
  value: "http://kalki-bet:3100"
{{- end -}}

{{/*
Redis env (shared).
*/}}
{{- define "kalki.redisEnv" -}}
- name: REDIS_HOST
  value: {{ .Values.redis.host | quote }}
- name: REDIS_PORT
  value: {{ .Values.redis.port | quote }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: kalki-redis-creds
      key: redis-password
- name: REDIS_URL
  valueFrom:
    secretKeyRef:
      name: kalki-redis-creds
      key: redis-url
- name: REDIS_KEY_PREFIX
  value: {{ .Values.redis.keyPrefix | quote }}
{{- end -}}

{{/*
DATABASE_URL env, computed from postgres values unless an override is set.
Args: dict "dbname" "uniquebid" "override" .Values.backend.databaseUrl "ctx" .
*/}}
{{- define "kalki.databaseUrl" -}}
{{- $ctx := .ctx -}}
{{- if .override -}}
{{ .override }}
{{- else -}}
postgresql://{{ $ctx.Values.postgres.user }}:{{ $ctx.Values.postgres.password }}@kalki-postgres:5432/{{ .dbname }}?schema=public
{{- end -}}
{{- end -}}
