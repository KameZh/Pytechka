from django.urls import path
from . import views

urlpatterns = [
  path("healthz", views.healthz),
  path("huts", views.huts_list),

  path("trails", views.trails_list),
  path("trails/geojson", views.trails_geojson),
  path("trails/<str:trail_id>", views.trail_detail),
]

