from django.urls import path
from . import views

urlpatterns = [
  path("healthz", views.healthz),
  path("huts", views.huts_list),
]

