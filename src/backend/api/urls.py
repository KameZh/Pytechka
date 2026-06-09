from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    path("healthz", views.healthz),
    path("readyz", views.readyz),
    path("user/profile", views.user_profile),
    path("trails", views.trails_list),
    path("trails/mine", views.my_trails),
    path("trails/telemetry", views.trail_telemetry),
    path("trails/geojson", views.trails_geojson),
    path("trails/<str:trail_id>/start-readiness", views.trail_start_readiness),
    path("trails/<str:trail_id>/conditions", views.trail_conditions),
    path("trails/<str:trail_id>/complete", views.trail_complete),
    path("trails/<str:trail_id>/reviews", views.trail_reviews),
    path("trails/<str:trail_id>", views.trail_detail),
    path("huts", views.huts_list),
    path("pings/photo", views.photo_ping_create),
    path("photo-pings", views.photo_pings),
    path("pings", views.pings),
    path("pings/<str:ping_id>/vote", views.ping_vote),
    path("pings/<str:ping_id>", views.ping_detail),
    path("clusters", views.clusters_list),
    path("clusters/<str:cluster_id>/vote", views.cluster_vote),
    path("offline-downloads", views.offline_downloads),
    path("offline-downloads/status", views.offline_download_status),
    path("offline-downloads/<str:download_id>", views.offline_download_detail),
    path("badges/trailers/complete", views.badge_trailer_complete),
    path("badges/campaign/participate", views.badge_campaign_participate),
]





