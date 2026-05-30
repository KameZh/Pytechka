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
  path("photo-pings", views.photo_pings_list),
  path("clusters", views.clusters_list)
]

