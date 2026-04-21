# Document processing is handled explicitly through Celery tasks
# from uploads.views / upload flows.
#
# Keeping this file prevents import errors if the app expects signals.py,
# but no automatic processing should happen here.