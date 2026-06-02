from django.urls import path
from . import views

urlpatterns = [
  path("healthz", views.healthz),
  path("huts", views.huts_list),

  path("user/profile", views.user_profile),

  path("trails", views.trails_list),
  path("trails/mine", views.my_trails),
  path("trails/geojson", views.trails_geojson),
  path("trails/<str:trail_id>", views.trail_detail),

  path("pings", views.pings_list),
  path("pings/<str:ping_id>/vote", views.ping_vote),
  path("photo-pings", views.photo_pings_list),
  path("clusters", views.clusters_list),

  path("offline-downloads", views.offline_downloads),
  path("offline-downloads/status", views.offline_download_status),
  path("offline-downloads/<str:download_id>", views.offline_download_detail),

  path("badges/trailers/complete", views.badge_trailer_complete),
  path("badges/campaign/participate", views.badge_campaign_participate)
]





