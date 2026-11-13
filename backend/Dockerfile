FROM golang:1.26-alpine AS build

WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /backend ./cmd/server

FROM alpine:3.23
RUN addgroup -S app && adduser -S app -G app
USER app
COPY --from=build /backend /usr/local/bin/backend
EXPOSE 8080
ENTRYPOINT ["backend"]
