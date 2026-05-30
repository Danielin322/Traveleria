from shared.response import success


def lambda_handler(event, context):
    return success({"status": "Traveleria Server is Online!"})
